import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { nextDocNumber } from '../lib/numbering';
import { computeCostSheet } from '../lib/productCosting';
import { loadMethodMap } from '../lib/methods';
import { round } from '../lib/costing';
import { buildBoard } from '../lib/production';
import { allocateFifo, buildStatement, jobworkEventsForOrder, type AllocationResult, type Bucket, type PaymentRow } from '../lib/finance';

const router = Router();
router.use(authenticate);
const canEdit = requireRole('Operator');
const canManage = requireRole('Manager');

// ---------------------------------------------------------------------------
// Material sheets — the live costing explosion for a product × qty.
// Production PROGRESS lives on the order board, never here.
// ---------------------------------------------------------------------------

const sheetInclude = {
  product: { select: { id: true, factoryCode: true, name: true, unit: { select: { code: true } } } },
  order: { select: { id: true, number: true, buyer: { select: { name: true } } } },
  orderLine: { select: { id: true, qty: true, stages: { select: { name: true, vendor: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' as const } } } },
};

/** Explode a product's live costing to per-piece + order-total figures. */
function explode(computed: any, qty: number) {
  if (!computed) return null;
  const groups = (computed.groups || []).map((g: any) => ({
    head: g.head,
    name: g.name,
    method: g.method,
    total: g.total,
    orderTotal: round(g.total * qty),
    lines: (g.lines || []).map((l: any) => ({
      name: l.name,
      unit: l.unit,
      measure: l.measure,
      amount: l.amount,
      orderMeasure: round((l.measure || 0) * qty, 3),
      orderAmount: round((l.amount || 0) * qty),
    })),
  }));
  const s = computed.summary;
  const headTotalsOrder: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.headTotals as Record<string, number>)) headTotalsOrder[k] = round(v * qty);
  return {
    currency: computed.currency ? { code: computed.currency.code, symbol: computed.currency.symbol } : null,
    perPiece: s,
    order: {
      qty,
      headTotals: headTotalsOrder,
      exFactory: round(s.exFactory * qty),
      forwarding: round(s.forwarding * qty),
      fob: round(s.fob * qty),
      nonFob: round(s.nonFob * qty),
    },
    groups,
  };
}

async function explosionFor(productId: number, qty: number) {
  const [methods, product] = await Promise.all([
    loadMethodMap(),
    prisma.product.findUnique({
      where: { id: productId },
      include: { costSheets: { where: { isActive: true }, include: { currency: true, groups: { orderBy: { sortOrder: 'asc' }, include: { lines: { orderBy: { sortOrder: 'asc' } } } } } } },
    }),
  ]);
  return explode(computeCostSheet(product?.costSheets?.[0], methods), qty);
}

router.get(
  '/operation-sheets',
  asyncHandler(async (req, res) => {
    const where = req.query.orderId ? { orderId: Number(req.query.orderId) } : undefined;
    res.json(await prisma.operationSheet.findMany({ where, include: sheetInclude, orderBy: { createdAt: 'desc' } }));
  })
);

router.get(
  '/operation-sheets/:id',
  asyncHandler(async (req, res) => {
    const sheet = await prisma.operationSheet.findUnique({ where: { id: Number(req.params.id) }, include: sheetInclude });
    if (!sheet) throw new ApiError(404, 'Material sheet not found.');
    res.json({ ...sheet, explosion: await explosionFor(sheet.productId, sheet.qty) });
  })
);

const sheetSchema = z.object({
  productId: z.number().int().optional(),
  orderId: z.number().int().nullable().optional(),
  orderLineId: z.number().int().nullable().optional(),
  qty: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Find-or-create. A sheet asked for by order line always returns the existing one,
 * so the floor never ends up with two sheets numbered differently for one job.
 */
router.post(
  '/operation-sheets',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = sheetSchema.parse(req.body);

    if (data.orderLineId) {
      const line = await prisma.orderLine.findUnique({ where: { id: data.orderLineId }, include: { sheet: true } });
      if (!line) throw new ApiError(404, 'Order line not found.');
      if (line.sheet) {
        const full = await prisma.operationSheet.findUnique({ where: { id: line.sheet.id }, include: sheetInclude });
        return res.status(200).json({ ...full!, explosion: await explosionFor(full!.productId, full!.qty), existing: true });
      }
      const number = await nextDocNumber('OP');
      const sheet = await prisma.operationSheet.create({
        data: { number, productId: line.productId, orderId: line.orderId, orderLineId: line.id, qty: data.qty ?? line.qty, notes: data.notes ?? null, createdById: req.user!.sub },
        include: sheetInclude,
      });
      return res.status(201).json({ ...sheet, explosion: await explosionFor(sheet.productId, sheet.qty) });
    }

    if (!data.productId) throw new ApiError(400, 'Pick a product (or an order line) for the sheet.');
    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new ApiError(404, 'Product not found.');
    const number = await nextDocNumber('OP');
    const sheet = await prisma.operationSheet.create({
      data: { number, productId: data.productId, orderId: data.orderId ?? null, qty: data.qty ?? 1, notes: data.notes ?? null, createdById: req.user!.sub },
      include: sheetInclude,
    });
    res.status(201).json({ ...sheet, explosion: await explosionFor(sheet.productId, sheet.qty) });
  })
);

router.put(
  '/operation-sheets/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = sheetSchema.parse(req.body);
    const sheet = await prisma.operationSheet.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(data.qty != null ? { qty: data.qty } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
      },
      include: sheetInclude,
    });
    res.json({ ...sheet, explosion: await explosionFor(sheet.productId, sheet.qty) });
  })
);

router.delete(
  '/operation-sheets/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await prisma.operationSheet.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Money — every figure derived from orders and the production board
//
//   buyer receivable = order value           - receipts, spread oldest-first
//   jobwork payable  = board-accrued jobwork - payments, spread oldest-first
//   material / wages = entered bills         - payments, spread oldest-first
//
// Nothing the system can work out is ever typed in, and no allocation is stored:
// spreading a payment is a pure function of what is outstanding, recomputed on
// every read (see lib/finance.ts). A payment bigger than the thing it names flows
// on to the next oldest debt; a surplus with nothing left to settle sits as credit.
// ---------------------------------------------------------------------------

const LIVE_ORDER = { status: { not: 'Cancelled' } } as const;

const financeOrderInclude = {
  buyer: { select: { id: true, name: true, code: true, email: true, phone: true, country: true } },
  currency: { select: { code: true, symbol: true } },
  lines: {
    include: {
      stages: { include: { vendor: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' as const } },
      moves: true,
      product: { select: { factoryCode: true, name: true } },
    },
  },
};

const financeEntryInclude = {
  supplier: { select: { id: true, name: true, code: true, type: true, phone: true, gstNo: true, paymentTerms: true } },
  buyer: { select: { id: true, name: true, code: true } },
  order: { select: { id: true, number: true } },
  stockTxn: { select: { id: true, qty: true, rate: true, date: true, rawItem: { select: { code: true, name: true, unit: true } } } },
};

/** Everything needed to compute the money position, in one read. */
async function financeData() {
  const [orders, entries, currencies] = await Promise.all([
    prisma.order.findMany({ where: LIVE_ORDER, include: financeOrderInclude, orderBy: [{ orderDate: 'asc' }, { id: 'asc' }] }),
    prisma.ledgerEntry.findMany({ include: financeEntryInclude, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    prisma.currency.findMany({ select: { code: true, symbol: true, rateToBase: true } }),
  ]);
  /**
   * Rupee rate for a currency code. Taken from the currency master rather than from
   * an order, because a receipt can sit in a currency the buyer has no live order in
   * — and falling back to 1 there would value it as if it were rupees.
   */
  const rateOf = (code: string) => currencies.find((c) => c.code === code)?.rateToBase ?? 1;
  const symbolOf = (code: string) => currencies.find((c) => c.code === code)?.symbol ?? '';
  return { orders, entries, rateOf, symbolOf };
}

type FinanceOrder = Awaited<ReturnType<typeof financeData>>['orders'][number];
type FinanceEntry = Awaited<ReturnType<typeof financeData>>['entries'][number];

const orderValue = (o: FinanceOrder) => round(o.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));

const entriesFor = (entries: FinanceEntry[], partyType: string, kind: 'BILL' | 'PAYMENT', partyId?: number | null, partyName?: string) =>
  entries.filter(
    (e) =>
      e.partyType === partyType &&
      e.kind === kind &&
      (partyId != null ? e.supplierId === partyId || e.buyerId === partyId : true) &&
      (partyName != null ? e.partyName === partyName : true)
  );

const toPaymentRows = (entries: FinanceEntry[]): PaymentRow[] => entries.map((e) => ({ id: e.id, date: e.date, amount: e.amount, orderId: e.orderId }));

const sumOf = (entries: { partyType: string; kind: string; amount: number }[], partyType: string, kind: string) =>
  entries.filter((e) => e.partyType === partyType && e.kind === kind).reduce((a, e) => a + e.amount, 0);

/** Attach the computed allocation back onto each payment entry for the API. */
function describePayments(entries: FinanceEntry[], result: AllocationResult) {
  return entries.map((e) => {
    const a = result.payments.find((p) => p.paymentId === e.id);
    return {
      id: e.id,
      date: e.date,
      amount: e.amount,
      currency: e.currency ?? 'INR',
      ref: e.ref,
      note: e.note,
      partyName: e.partyName,
      aimedAtOrder: e.order?.number ?? null,
      allocations: a?.allocations ?? [],
      unallocated: a?.unallocated ?? 0,
    };
  });
}

/**
 * A buyer's position, per currency: their orders are the debts and their receipts
 * settle them oldest-first. Receipts only ever apply to orders in the same currency,
 * so no hidden conversion can creep into a balance.
 */
function buyerPositions(orders: FinanceOrder[], entries: FinanceEntry[], buyerId: number, rateOf: (code: string) => number, symbolOf: (code: string) => string) {
  const mine = orders.filter((o) => o.buyerId === buyerId);
  const receipts = entriesFor(entries, 'BUYER', 'PAYMENT', buyerId);
  const currencies = [...new Set([...mine.map((o) => o.currency?.code ?? 'INR'), ...receipts.map((r) => r.currency ?? 'INR')])];

  return currencies.map((code) => {
    const ordersInCcy = mine.filter((o) => (o.currency?.code ?? 'INR') === code);
    const receiptsInCcy = receipts.filter((r) => (r.currency ?? 'INR') === code);
    const buckets: Bucket[] = ordersInCcy.map((o) => ({ key: `order-${o.id}`, orderId: o.id, label: o.number, date: o.orderDate, gross: orderValue(o) }));
    const result = allocateFifo(buckets, toPaymentRows(receiptsInCcy));
    const rate = rateOf(code);
    return {
      currency: code,
      symbol: symbolOf(code) || '₹',
      exchangeRate: rate,
      invoiced: round(buckets.reduce((a, b) => a + b.gross, 0)),
      received: round(receiptsInCcy.reduce((a, r) => a + r.amount, 0)),
      balance: round(result.buckets.reduce((a, b) => a + b.balance, 0)),
      credit: result.credit,
      buckets: result.buckets,
      orders: ordersInCcy,
      receipts: describePayments(receiptsInCcy, result),
      result,
    };
  });
}

/**
 * A jobwork vendor's position. The debts are the earnings accrued per order — the
 * pieces they cleared times the rate on that stage — dated by the first movement on
 * that order, so payments settle the oldest work first.
 */
function jobworkPosition(orders: FinanceOrder[], entries: FinanceEntry[], vendorId: number) {
  const events = orders.flatMap((o) => jobworkEventsForOrder(o as any)).filter((e) => e.vendorId === vendorId);
  const perOrder = new Map<number, { orderId: number; orderNumber: string; date: Date | string; gross: number; pieces: number }>();
  for (const e of events) {
    const row = perOrder.get(e.orderId) ?? { orderId: e.orderId, orderNumber: e.orderNumber, date: e.date, gross: 0, pieces: 0 };
    row.gross = round(row.gross + e.amount);
    row.pieces += e.pieces;
    if (new Date(e.date) < new Date(row.date)) row.date = e.date;
    perOrder.set(e.orderId, row);
  }
  const buckets: Bucket[] = [...perOrder.values()].map((r) => ({ key: `order-${r.orderId}`, orderId: r.orderId, label: r.orderNumber, date: r.date, gross: r.gross }));
  const payments = entriesFor(entries, 'JOBWORK', 'PAYMENT', vendorId);
  const result = allocateFifo(buckets, toPaymentRows(payments));
  return { events, buckets: result.buckets, perOrder: [...perOrder.values()], payments: describePayments(payments, result), result };
}

/**
 * A material supplier's (or worker's) position. Here the debts are the bills we
 * entered, because nothing else knows what they charged.
 */
function billedPosition(entries: FinanceEntry[], partyType: 'SUPPLIER' | 'WORKER', partyId: number | null, partyName?: string) {
  const bills = entriesFor(entries, partyType, 'BILL', partyId, partyName);
  const buckets: Bucket[] = bills.map((b) => ({
    key: `bill-${b.id}`,
    orderId: b.orderId,
    label: b.ref || (b.stockTxn ? `${b.stockTxn.rawItem.name} receipt` : `Bill #${b.id}`),
    date: b.date,
    gross: b.amount,
  }));
  const payments = entriesFor(entries, partyType, 'PAYMENT', partyId, partyName);
  const result = allocateFifo(buckets, toPaymentRows(payments));
  return { bills, buckets: result.buckets, payments: describePayments(payments, result), result };
}

// --- receivables ------------------------------------------------------------

router.get(
  '/finance/receivables',
  asyncHandler(async (_req, res) => {
    const { orders, entries, rateOf, symbolOf } = await financeData();
    const buyerIds = [...new Set(orders.map((o) => o.buyerId))];

    const rows: any[] = [];
    const credits: any[] = [];
    for (const buyerId of buyerIds) {
      for (const pos of buyerPositions(orders, entries, buyerId, rateOf, symbolOf)) {
        const buyer = pos.orders[0]?.buyer;
        for (const b of pos.buckets) {
          const order = pos.orders.find((o) => o.id === b.orderId)!;
          const settled = pos.receipts.filter((r) => r.allocations.some((a) => a.orderId === b.orderId));
          rows.push({
            orderId: order.id,
            orderNumber: order.number,
            buyerId,
            buyerName: order.buyer.name,
            status: order.status,
            orderDate: order.orderDate,
            deliveryDate: order.deliveryDate,
            currency: pos.currency,
            symbol: pos.symbol,
            exchangeRate: order.exchangeRate ?? 1,
            invoiced: b.gross,
            received: b.paid,
            balance: b.balance,
            balanceInr: round(b.balance * (order.exchangeRate ?? 1)),
            receiptCount: settled.length,
            receipts: settled.map((r) => ({
              id: r.id,
              date: r.date,
              ref: r.ref,
              amount: r.allocations.find((a) => a.orderId === b.orderId)!.amount,
              fullAmount: r.amount,
              spreadAcross: r.allocations.length,
              aimedAtOrder: r.aimedAtOrder,
            })),
          });
        }
        if (pos.credit > 0 && buyer) {
          credits.push({ buyerId, buyerName: buyer.name, currency: pos.currency, symbol: pos.symbol, amount: pos.credit });
        }
      }
    }

    rows.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
    res.json({ rows, credits });
  })
);

// --- payables ---------------------------------------------------------------

router.get(
  '/finance/payables',
  asyncHandler(async (_req, res) => {
    const { orders, entries, rateOf, symbolOf } = await financeData();

    const rows: any[] = [];

    // Jobwork vendors — everyone who owns a stage that has cleared pieces.
    const allEvents = orders.flatMap((o) => jobworkEventsForOrder(o as any));
    for (const vendorId of [...new Set(allEvents.map((e) => e.vendorId))]) {
      const pos = jobworkPosition(orders, entries, vendorId);
      const name = allEvents.find((e) => e.vendorId === vendorId)!.vendorName;
      const accrued = round(pos.buckets.reduce((a, b) => a + b.gross, 0));
      const paid = round(pos.buckets.reduce((a, b) => a + b.paid, 0));
      rows.push({
        partyType: 'JOBWORK',
        supplierId: vendorId,
        partyName: name,
        accrued,
        paid,
        balance: round(accrued - paid),
        credit: pos.result.credit,
        pieces: pos.events.reduce((a, e) => a + e.pieces, 0),
        events: pos.events.length,
        jobs: pos.perOrder.map((r) => {
          const bucket = pos.buckets.find((b) => b.orderId === r.orderId)!;
          return {
            orderId: r.orderId,
            orderNumber: r.orderNumber,
            pieces: r.pieces,
            amount: r.gross,
            paid: bucket.paid,
            balance: bucket.balance,
            stages: [...new Set(pos.events.filter((e) => e.orderId === r.orderId).map((e) => e.stage))],
            product: [...new Set(pos.events.filter((e) => e.orderId === r.orderId).map((e) => `${e.productCode} — ${e.productName}`))].join(', '),
          };
        }),
      });
    }

    // Material suppliers and workers — from the bills we entered.
    const billed = entries.filter((e) => (e.partyType === 'SUPPLIER' || e.partyType === 'WORKER') && (e.kind === 'BILL' || e.kind === 'PAYMENT'));
    const keys = [...new Set(billed.map((e) => `${e.partyType}:${e.supplierId ?? e.partyName}`))];
    for (const key of keys) {
      const [partyType, idOrName] = key.split(':') as ['SUPPLIER' | 'WORKER', string];
      const supplierId = /^\d+$/.test(idOrName) ? Number(idOrName) : null;
      const partyName = supplierId == null ? idOrName : undefined;
      const pos = billedPosition(entries, partyType, supplierId, partyName);
      const accrued = round(pos.buckets.reduce((a, b) => a + b.gross, 0));
      const paid = round(pos.buckets.reduce((a, b) => a + b.paid, 0));
      const label = supplierId != null ? pos.bills[0]?.supplier?.name ?? pos.payments[0]?.partyName ?? `#${supplierId}` : idOrName;
      rows.push({
        partyType,
        supplierId,
        partyName: label,
        accrued,
        paid,
        balance: round(accrued - paid),
        credit: pos.result.credit,
        pieces: 0,
        events: pos.bills.length,
        jobs: pos.buckets.map((b) => ({
          orderId: b.orderId,
          orderNumber: b.label,
          pieces: 0,
          amount: b.gross,
          paid: b.paid,
          balance: b.balance,
          stages: [],
          product: '',
        })),
      });
    }

    res.json(rows.sort((a, b) => b.balance - a.balance));
  })
);

// --- summary ----------------------------------------------------------------

/** Headline money totals, shared by the summary endpoint and the dashboard. */
async function financeTotals() {
  {
    const { orders, entries, rateOf, symbolOf } = await financeData();

    let invoicedInr = 0;
    let receivableInr = 0;
    let buyerCreditInr = 0;
    for (const buyerId of [...new Set(orders.map((o) => o.buyerId))]) {
      for (const pos of buyerPositions(orders, entries, buyerId, rateOf, symbolOf)) {
        const rate = pos.orders[0]?.exchangeRate ?? 1;
        invoicedInr += pos.invoiced * rate;
        receivableInr += pos.balance * rate;
        buyerCreditInr += pos.credit * rate;
      }
    }

    const allEvents = orders.flatMap((o) => jobworkEventsForOrder(o as any));
    const jobworkAccrued = round(allEvents.reduce((a, e) => a + e.amount, 0));
    const jobworkPaid = sumOf(entries, 'JOBWORK', 'PAYMENT');
    const materialBilled = sumOf(entries, 'SUPPLIER', 'BILL');
    const materialPaid = sumOf(entries, 'SUPPLIER', 'PAYMENT');
    const wagesBilled = sumOf(entries, 'WORKER', 'BILL');
    const wagesPaid = sumOf(entries, 'WORKER', 'PAYMENT');

    // Overpayment to a party is money on account, not a negative debt.
    const clamp = (v: number) => round(Math.max(v, 0));
    const jobworkDue = clamp(jobworkAccrued - jobworkPaid);
    const materialDue = clamp(materialBilled - materialPaid);
    const wagesDue = clamp(wagesBilled - wagesPaid);

    return {
      invoicedInr: round(invoicedInr),
      receivedInr: round(invoicedInr - receivableInr),
      receivableInr: round(receivableInr),
      buyerCreditInr: round(buyerCreditInr),
      jobworkAccrued,
      jobworkPaid: round(jobworkPaid),
      jobworkDue,
      materialBilled: round(materialBilled),
      materialPaid: round(materialPaid),
      materialDue,
      wagesBilled: round(wagesBilled),
      wagesPaid: round(wagesPaid),
      wagesDue,
      payableInr: round(jobworkDue + materialDue + wagesDue),
      jobworkEvents: allEvents.length,
    };
  }
}

router.get(
  '/finance/summary',
  asyncHandler(async (_req, res) => {
    res.json(await financeTotals());
  })
);

// --- the parties index ------------------------------------------------------

router.get(
  '/finance/parties',
  asyncHandler(async (_req, res) => {
    const { orders, entries, rateOf, symbolOf } = await financeData();
    const out: any[] = [];

    for (const buyerId of [...new Set(orders.map((o) => o.buyerId))]) {
      const positions = buyerPositions(orders, entries, buyerId, rateOf, symbolOf);
      const buyer = positions.find((p) => p.orders.length)?.orders[0].buyer;
      if (!buyer) continue;
      out.push({
        partyType: 'BUYER',
        partyId: buyerId,
        name: buyer.name,
        code: buyer.code,
        owesUs: round(positions.reduce((a, p) => a + p.balance * (p.orders[0]?.exchangeRate ?? 1), 0)),
        weOwe: 0,
        credit: round(positions.reduce((a, p) => a + p.credit * (p.orders[0]?.exchangeRate ?? 1), 0)),
        orders: positions.reduce((a, p) => a + p.orders.length, 0),
      });
    }

    const allEvents = orders.flatMap((o) => jobworkEventsForOrder(o as any));
    for (const vendorId of [...new Set(allEvents.map((e) => e.vendorId))]) {
      const pos = jobworkPosition(orders, entries, vendorId);
      const accrued = round(pos.buckets.reduce((a, b) => a + b.gross, 0));
      const paid = round(pos.buckets.reduce((a, b) => a + b.paid, 0));
      out.push({
        partyType: 'JOBWORK',
        partyId: vendorId,
        name: allEvents.find((e) => e.vendorId === vendorId)!.vendorName,
        code: null,
        owesUs: 0,
        weOwe: round(accrued - paid),
        credit: pos.result.credit,
        orders: pos.perOrder.length,
      });
    }

    const billed = entries.filter((e) => e.partyType === 'SUPPLIER' || e.partyType === 'WORKER');
    for (const key of [...new Set(billed.map((e) => `${e.partyType}:${e.supplierId ?? e.partyName}`))]) {
      const [partyType, idOrName] = key.split(':') as ['SUPPLIER' | 'WORKER', string];
      const supplierId = /^\d+$/.test(idOrName) ? Number(idOrName) : null;
      const pos = billedPosition(entries, partyType, supplierId, supplierId == null ? idOrName : undefined);
      const accrued = round(pos.buckets.reduce((a, b) => a + b.gross, 0));
      const paid = round(pos.buckets.reduce((a, b) => a + b.paid, 0));
      out.push({
        partyType,
        partyId: supplierId,
        name: supplierId != null ? pos.bills[0]?.supplier?.name ?? pos.payments[0]?.partyName ?? `#${supplierId}` : idOrName,
        code: pos.bills[0]?.supplier?.code ?? null,
        owesUs: 0,
        weOwe: round(accrued - paid),
        credit: pos.result.credit,
        orders: pos.bills.length,
      });
    }

    res.json(out.sort((a, b) => b.weOwe + b.owesUs - (a.weOwe + a.owesUs)));
  })
);

// --- one party, in full -----------------------------------------------------

/**
 * Everything about one party: a running statement, the per-order breakdown, the
 * detail behind every charge, and how each payment was spread.
 */
router.get(
  '/finance/statement',
  asyncHandler(async (req, res) => {
    const q = z
      .object({
        partyType: z.enum(['BUYER', 'JOBWORK', 'SUPPLIER', 'WORKER']),
        partyId: z.coerce.number().int().optional(),
        partyName: z.string().optional(),
      })
      .parse(req.query);
    const { orders, entries, rateOf, symbolOf } = await financeData();

    if (q.partyType === 'BUYER') {
      if (!q.partyId) throw new ApiError(400, 'Which buyer?');
      const positions = buyerPositions(orders, entries, q.partyId, rateOf, symbolOf);
      const buyer = positions.find((p) => p.orders.length)?.orders[0].buyer ?? (await prisma.buyer.findUnique({ where: { id: q.partyId } }));
      if (!buyer) throw new ApiError(404, 'Buyer not found.');

      const currencies = positions.map((pos) => ({
        currency: pos.currency,
        symbol: pos.symbol,
        invoiced: pos.invoiced,
        received: pos.received,
        balance: pos.balance,
        credit: pos.credit,
        orders: pos.buckets.map((b) => {
          const order = pos.orders.find((o) => o.id === b.orderId)!;
          return { orderId: order.id, orderNumber: order.number, date: order.orderDate, status: order.status, gross: b.gross, paid: b.paid, balance: b.balance };
        }),
        receipts: pos.receipts,
        statement: buildStatement([
          ...pos.buckets.map((b) => {
            const order = pos.orders.find((o) => o.id === b.orderId)!;
            return {
              date: order.orderDate,
              type: 'INVOICE' as const,
              description: `Order ${order.number}`,
              ref: order.number,
              orderNumber: order.number,
              charge: b.gross,
              settle: 0,
              detail: `${order.lines.length} item(s), ${order.lines.reduce((a, l) => a + l.qty, 0)} pcs`,
            };
          }),
          // A statement only settles what was actually applied; money with nothing
          // left to settle is credit on account, not a reduction of a debt.
          ...pos.receipts.map((r) => {
            const applied = round(r.allocations.reduce((a, x) => a + x.amount, 0));
            return {
              date: r.date,
              type: 'RECEIPT' as const,
              description: r.allocations.length ? `Receipt applied to ${r.allocations.map((a) => a.label).join(', ')}` : 'Receipt held on account',
              ref: r.ref,
              orderNumber: r.allocations[0]?.label ?? null,
              charge: 0,
              settle: applied,
              detail: r.unallocated > 0 ? `Received ${r.amount.toFixed(2)} · ${r.unallocated.toFixed(2)} held on account` : null,
            };
          }),
        ]),
      }));

      return res.json({ party: { partyType: 'BUYER', partyId: buyer.id, name: buyer.name, code: (buyer as any).code, email: (buyer as any).email ?? null, phone: (buyer as any).phone ?? null }, currencies });
    }

    if (q.partyType === 'JOBWORK') {
      if (!q.partyId) throw new ApiError(400, 'Which vendor?');
      const vendor = await prisma.supplier.findUnique({ where: { id: q.partyId } });
      if (!vendor) throw new ApiError(404, 'Vendor not found.');
      const pos = jobworkPosition(orders, entries, q.partyId);
      const accrued = round(pos.buckets.reduce((a, b) => a + b.gross, 0));
      const paid = round(pos.buckets.reduce((a, b) => a + b.paid, 0));

      return res.json({
        party: { partyType: 'JOBWORK', partyId: vendor.id, name: vendor.name, code: vendor.code, phone: vendor.phone, gstNo: vendor.gstNo, paymentTerms: vendor.paymentTerms },
        currency: 'INR',
        summary: { accrued, paid, balance: round(accrued - paid), credit: pos.result.credit, pieces: pos.events.reduce((a, e) => a + e.pieces, 0), events: pos.events.length },
        perOrder: pos.buckets.map((b) => {
          const row = pos.perOrder.find((r) => r.orderId === b.orderId)!;
          return { orderId: b.orderId, orderNumber: b.label, pieces: row.pieces, gross: b.gross, paid: b.paid, balance: b.balance };
        }),
        events: pos.events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        payments: pos.payments,
        statement: buildStatement([
          ...pos.events.map((e) => ({
            date: e.date,
            type: 'ACCRUAL' as const,
            description: `${e.pieces} pcs cleared ${e.stage} — ${e.productCode}`,
            ref: e.orderNumber,
            orderNumber: e.orderNumber,
            charge: e.amount,
            settle: 0,
            detail: `${e.pieces} × ₹${e.rate}/pc${e.rework ? ' · re-done after rejection' : ''}${e.note ? ` · ${e.note}` : ''}`,
          })),
          ...pos.payments.map((p) => {
            const applied = round(p.allocations.reduce((a, x) => a + x.amount, 0));
            return {
              date: p.date,
              type: 'PAYMENT' as const,
              description: p.allocations.length ? `Payment applied to ${p.allocations.map((a) => a.label).join(', ')}` : 'Paid in advance — nothing outstanding',
              ref: p.ref,
              orderNumber: p.allocations[0]?.label ?? null,
              charge: 0,
              settle: applied,
              detail: p.unallocated > 0 ? `Paid ₹${p.amount.toFixed(2)} · ₹${p.unallocated.toFixed(2)} sits in advance` : null,
            };
          }),
        ]),
      });
    }

    // SUPPLIER / WORKER
    const supplierId = q.partyId ?? null;
    const pos = billedPosition(entries, q.partyType, supplierId, supplierId == null ? q.partyName : undefined);
    const supplier = supplierId != null ? await prisma.supplier.findUnique({ where: { id: supplierId } }) : null;
    const accrued = round(pos.buckets.reduce((a, b) => a + b.gross, 0));
    const paid = round(pos.buckets.reduce((a, b) => a + b.paid, 0));

    // Deliveries recorded in stock that nobody has billed yet.
    const receipts =
      q.partyType === 'SUPPLIER' && supplierId != null
        ? await prisma.stockTxn.findMany({
            where: { supplierId, type: 'IN' },
            include: { rawItem: { select: { code: true, name: true, unit: true } }, bill: { select: { id: true, amount: true, ref: true } } },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
          })
        : [];

    res.json({
      party: {
        partyType: q.partyType,
        partyId: supplierId,
        name: supplier?.name ?? q.partyName ?? '—',
        code: supplier?.code ?? null,
        phone: supplier?.phone ?? null,
        gstNo: supplier?.gstNo ?? null,
        paymentTerms: supplier?.paymentTerms ?? null,
      },
      currency: 'INR',
      summary: { accrued, paid, balance: round(accrued - paid), credit: pos.result.credit, pieces: 0, events: pos.bills.length },
      perOrder: pos.buckets.map((b) => ({ orderId: b.orderId, orderNumber: b.label, pieces: 0, gross: b.gross, paid: b.paid, balance: b.balance })),
      bills: pos.bills.map((b) => ({
        id: b.id,
        date: b.date,
        amount: b.amount,
        ref: b.ref,
        note: b.note,
        orderNumber: b.order?.number ?? null,
        stockTxn: b.stockTxn ? { id: b.stockTxn.id, item: `${b.stockTxn.rawItem.code} — ${b.stockTxn.rawItem.name}`, qty: b.stockTxn.qty, unit: b.stockTxn.rawItem.unit, rate: b.stockTxn.rate } : null,
      })),
      payments: pos.payments,
      supplied: receipts.map((r) => ({
        id: r.id,
        date: r.date,
        item: `${r.rawItem.code} — ${r.rawItem.name}`,
        qty: r.qty,
        unit: r.rawItem.unit,
        rate: r.rate,
        value: round(r.qty * r.rate),
        note: r.note,
        billed: !!r.bill,
        billId: r.bill?.id ?? null,
      })),
      unbilledValue: round(receipts.filter((r) => !r.bill).reduce((a, r) => a + r.qty * r.rate, 0)),
      statement: buildStatement([
        ...pos.bills.map((b) => ({
          date: b.date,
          type: 'BILL' as const,
          description: b.stockTxn ? `Bill — ${b.stockTxn.rawItem.name} ${b.stockTxn.qty} ${b.stockTxn.rawItem.unit}` : b.note || 'Bill',
          ref: b.ref,
          orderNumber: b.order?.number ?? null,
          charge: b.amount,
          settle: 0,
          detail: b.stockTxn ? `${b.stockTxn.qty} × ₹${b.stockTxn.rate}` : null,
        })),
        ...pos.payments.map((p) => {
          const applied = round(p.allocations.reduce((a, x) => a + x.amount, 0));
          return {
            date: p.date,
            type: 'PAYMENT' as const,
            description: p.allocations.length ? `Payment applied to ${p.allocations.map((a) => a.label).join(', ')}` : 'Paid in advance — nothing outstanding',
            ref: p.ref,
            orderNumber: null,
            charge: 0,
            settle: applied,
            detail: p.unallocated > 0 ? `Paid ₹${p.amount.toFixed(2)} · ₹${p.unallocated.toFixed(2)} sits in advance` : null,
          };
        }),
      ]),
    });
  })
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const where: any = {};
    if (req.query.partyType) where.partyType = req.query.partyType;
    if (req.query.supplierId) where.supplierId = Number(req.query.supplierId);
    if (req.query.buyerId) where.buyerId = Number(req.query.buyerId);
    if (req.query.orderId) where.orderId = Number(req.query.orderId);
    res.json(
      await prisma.ledgerEntry.findMany({
        where,
        include: { supplier: { select: { name: true } }, buyer: { select: { name: true } }, order: { select: { id: true, number: true } } },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 300,
      })
    );
  })
);

const ledgerSchema = z.object({
  partyType: z.enum(['SUPPLIER', 'JOBWORK', 'BUYER', 'WORKER']),
  supplierId: z.number().int().nullable().optional(),
  buyerId: z.number().int().nullable().optional(),
  orderId: z.number().int().nullable().optional(),
  stockTxnId: z.number().int().nullable().optional(),
  partyName: z.string().min(1),
  kind: z.enum(['BILL', 'PAYMENT']),
  amount: z.number().positive(),
  currency: z.string().optional().default('INR'),
  date: z.string().datetime().optional(),
  ref: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

router.post(
  '/payments',
  canManage,
  asyncHandler(async (req, res) => {
    const data = ledgerSchema.parse(req.body);

    // Amounts the system already derives must not also be typed in, or they double up.
    if (data.partyType === 'BUYER' && data.kind === 'BILL') {
      throw new ApiError(400, 'What a buyer owes comes from their order value — record only the receipts here.');
    }
    if (data.partyType === 'JOBWORK' && data.kind === 'BILL') {
      throw new ApiError(400, 'Jobwork owed is calculated from the pieces each vendor cleared — record only the payments here.');
    }
    if (data.partyType === 'BUYER' && !data.buyerId) throw new ApiError(400, 'Which buyer is this receipt from?');

    // The party must exist and match the row's type, or the entry lands in a ledger
    // nobody is looking at.
    if (data.partyType === 'BUYER') {
      if (!(await prisma.buyer.findUnique({ where: { id: data.buyerId! } }))) throw new ApiError(404, 'Buyer not found.');
      if (data.supplierId) throw new ApiError(400, 'A buyer receipt cannot also name a supplier.');
    } else if (data.partyType === 'WORKER') {
      if (data.supplierId || data.buyerId) throw new ApiError(400, 'Wages are recorded against a worker name, not a supplier or buyer.');
    } else {
      if (!data.supplierId) throw new ApiError(400, `Which ${data.partyType === 'JOBWORK' ? 'jobwork vendor' : 'supplier'} is this for?`);
      const s = await prisma.supplier.findUnique({ where: { id: data.supplierId } });
      if (!s) throw new ApiError(404, 'Supplier not found.');
      if (data.partyType === 'JOBWORK' && s.type === 'MATERIAL') throw new ApiError(400, `${s.name} is a material supplier, not a jobwork vendor.`);
      if (data.partyType === 'SUPPLIER' && s.type === 'JOBWORK') throw new ApiError(400, `${s.name} is a jobwork vendor — record their work under Jobwork.`);
      if (data.buyerId) throw new ApiError(400, 'A supplier entry cannot also name a buyer.');
    }

    // Everything except a buyer receipt is settled in rupees. Accepting another
    // currency here would silently mix units inside the payable totals.
    let currency = data.partyType === 'BUYER' ? data.currency ?? 'INR' : 'INR';
    if (data.partyType === 'BUYER') {
      // A receipt settles orders in its own currency, so pin it to one. The order
      // named here is a starting point only — a surplus rolls on to older orders.
      const buyerId = data.buyerId!;
      if (data.orderId) {
        const order = await prisma.order.findUnique({ where: { id: data.orderId }, include: { currency: true } });
        if (!order) throw new ApiError(404, 'Order not found.');
        if (order.buyerId !== buyerId) throw new ApiError(400, 'That order belongs to a different buyer.');
        currency = order.currency?.code ?? 'INR';
      } else {
        const latest = await prisma.order.findFirst({ where: { buyerId, ...LIVE_ORDER }, include: { currency: true }, orderBy: [{ orderDate: 'desc' }, { id: 'desc' }] });
        if (!latest) throw new ApiError(400, 'This buyer has no live order for the receipt to settle.');
        currency = latest.currency?.code ?? 'INR';
      }
    }

    if (data.stockTxnId) {
      const txn = await prisma.stockTxn.findUnique({ where: { id: data.stockTxnId }, include: { bill: true } });
      if (!txn) throw new ApiError(404, 'Stock receipt not found.');
      if (txn.bill) throw new ApiError(409, 'That stock receipt is already billed.');
      if (data.kind !== 'BILL') throw new ApiError(400, 'A stock receipt is billed, not paid — record the payment separately.');
    }

    res.status(201).json(
      await prisma.ledgerEntry.create({
        data: {
          partyType: data.partyType,
          supplierId: data.supplierId ?? null,
          buyerId: data.buyerId ?? null,
          orderId: data.orderId ?? null,
          stockTxnId: data.stockTxnId ?? null,
          partyName: data.partyName,
          kind: data.kind,
          amount: data.amount,
          currency,
          date: data.date ? new Date(data.date) : new Date(),
          ref: data.ref ?? null,
          note: data.note ?? null,
          createdById: req.user!.sub,
        },
      })
    );
  })
);

router.delete(
  '/payments/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await prisma.ledgerEntry.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get(
  '/ops/dashboard',
  asyncHandler(async (_req, res) => {
    const [openOrders, awaitingDecision, recentProformas, rawItems, stockGrouped, liveLines, financials] = await Promise.all([
      prisma.order.findMany({ where: { status: { notIn: ['Shipped', 'Closed', 'Cancelled'] } }, select: { id: true } }),
      prisma.proforma.count({ where: { status: 'Sent' } }),
      prisma.proforma.findMany({ include: { buyer: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 6 }),
      prisma.rawItem.findMany(),
      prisma.stockTxn.groupBy({ by: ['rawItemId', 'type'], _sum: { qty: true } }),
      prisma.orderLine.findMany({
        where: { order: LIVE_ORDER },
        include: { stages: { include: { vendor: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' } }, moves: true },
      }),
      // One source of truth for the money, shared with the Payments page.
      financeTotals(),
    ]);

    let inProduction = 0;
    let atVendors = 0;
    let pendingPieces = 0;
    let finishedPieces = 0;
    const vendorLoad = new Map<number, { vendorId: number; vendorName: string; pieces: number }>();
    for (const l of liveLines) {
      const board = buildBoard(l.qty, l.stages as any, l.moves as any);
      inProduction += board.wip;
      pendingPieces += board.pending;
      finishedPieces += board.done;
      for (const s of board.stages) {
        if (s.vendorId && s.at > 0) {
          atVendors += s.at;
          const row = vendorLoad.get(s.vendorId) ?? { vendorId: s.vendorId, vendorName: s.vendor?.name ?? `Vendor #${s.vendorId}`, pieces: 0 };
          row.pieces += s.at;
          vendorLoad.set(s.vendorId, row);
        }
      }
    }

    const bal: Record<number, { i: number; o: number }> = {};
    for (const g of stockGrouped) {
      bal[g.rawItemId] = bal[g.rawItemId] || { i: 0, o: 0 };
      if (g.type === 'IN') bal[g.rawItemId].i = g._sum.qty || 0;
      else bal[g.rawItemId].o = g._sum.qty || 0;
    }
    const lowStock = rawItems
      .map((it) => ({ id: it.id, name: it.name, unit: it.unit, balance: round(it.openingQty + (bal[it.id]?.i || 0) - (bal[it.id]?.o || 0), 3), reorderLevel: it.reorderLevel }))
      .filter((it) => it.balance <= it.reorderLevel);

    res.json({
      pendingOrders: openOrders.length,
      awaitingDecision,
      inProduction,
      atVendors,
      pendingPieces,
      finishedPieces,
      jobworkAccrued: financials.jobworkAccrued,
      receivable: financials.receivableInr,
      payable: financials.payableInr,
      buyerCredit: financials.buyerCreditInr,
      vendorLoad: Array.from(vendorLoad.values()).sort((a, b) => b.pieces - a.pieces),
      recentProformas: recentProformas.map((p) => ({ id: p.id, number: p.number, buyer: p.buyer.name, status: p.status, date: p.date })),
      lowStock,
    });
  })
);

export default router;
