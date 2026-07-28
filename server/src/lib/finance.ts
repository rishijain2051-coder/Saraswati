/**
 * The accounting layer: what each party is owed or owes, explained down to the
 * individual movement, and how every payment is spread across the outstanding work.
 *
 * TWO RULES HOLD EVERYWHERE
 *
 * 1. Nothing the system can work out is ever typed in. A buyer's debt is the value
 *    of their orders; a jobwork vendor's earnings are the pieces they cleared times
 *    the rate on that stage. Only material bills and wages are entered by hand,
 *    because nothing else knows them.
 *
 * 2. Allocation is COMPUTED, never stored. Spreading a payment across orders is a
 *    pure function of (what is outstanding, what has been paid), so it is derived on
 *    every read. That means an order changing value, or more jobwork accruing, can
 *    never leave a stale allocation behind — there is nothing to go stale.
 */
import { round } from './costing';
import { buildBoard, clearances, type MoveRow, type StageRow } from './production';

// ---------------------------------------------------------------------------
// FIFO allocation
// ---------------------------------------------------------------------------

/** Something owed, oldest first. `key` identifies it; `orderId` may be null. */
export interface Bucket {
  key: string;
  orderId: number | null;
  label: string;
  date: Date | string;
  /** Total owed on this bucket before any payment is applied. */
  gross: number;
}

export interface PaymentRow {
  id: number;
  date: Date | string;
  amount: number;
  /** The order the payment was aimed at, if any. Honoured before the spill-over. */
  orderId?: number | null;
}

export interface Allocation {
  key: string;
  orderId: number | null;
  label: string;
  amount: number;
}

export interface AllocatedPayment {
  paymentId: number;
  allocations: Allocation[];
  /** Money that had nothing left to settle — sits as credit on account. */
  unallocated: number;
}

export interface AllocationResult {
  payments: AllocatedPayment[];
  /** Per bucket: gross, how much landed on it, and what remains. */
  buckets: (Bucket & { paid: number; balance: number })[];
  /** Total money that could not be applied to anything. */
  credit: number;
}

const byDate = (a: { date: Date | string; id?: number }, b: { date: Date | string; id?: number }) => {
  const d = new Date(a.date).getTime() - new Date(b.date).getTime();
  return d !== 0 ? d : (a.id ?? 0) - (b.id ?? 0);
};

/**
 * Spread payments across buckets oldest-first.
 *
 * A payment that names an order settles that order first — the operator's stated
 * intent wins — and only the surplus flows on to the next oldest thing outstanding.
 * Whatever is still left over is credit on account rather than being forced onto an
 * order that does not owe it.
 */
export function allocateFifo(buckets: Bucket[], payments: PaymentRow[]): AllocationResult {
  const ordered = [...buckets].sort(byDate);
  const remaining = new Map<string, number>(ordered.map((b) => [b.key, b.gross]));
  const paid = new Map<string, number>(ordered.map((b) => [b.key, 0]));

  const results: AllocatedPayment[] = [];
  for (const p of [...payments].sort(byDate)) {
    let left = round(p.amount);
    const allocations: Allocation[] = [];

    const apply = (bucket: Bucket) => {
      if (left <= 0) return;
      const rem = remaining.get(bucket.key) ?? 0;
      if (rem <= 0) return;
      const amount = round(Math.min(rem, left));
      if (amount <= 0) return;
      remaining.set(bucket.key, round(rem - amount));
      paid.set(bucket.key, round((paid.get(bucket.key) ?? 0) + amount));
      left = round(left - amount);
      const existing = allocations.find((a) => a.key === bucket.key);
      if (existing) existing.amount = round(existing.amount + amount);
      else allocations.push({ key: bucket.key, orderId: bucket.orderId, label: bucket.label, amount });
    };

    if (p.orderId != null) {
      const aimed = ordered.find((b) => b.orderId === p.orderId);
      if (aimed) apply(aimed);
    }
    for (const b of ordered) apply(b);

    results.push({ paymentId: p.id, allocations, unallocated: left });
  }

  return {
    payments: results,
    buckets: ordered.map((b) => ({ ...b, paid: paid.get(b.key) ?? 0, balance: round(b.gross - (paid.get(b.key) ?? 0)) })),
    credit: round(results.reduce((a, r) => a + r.unallocated, 0)),
  };
}

// ---------------------------------------------------------------------------
// One shared money picture
//
// Both the Payments screens and an individual order read their figures from here,
// so a receipt that FIFO moved onto another order can never show one number in one
// place and a different number in another.
// ---------------------------------------------------------------------------

export interface FinanceOrderLike {
  id: number;
  number: string;
  buyerId: number;
  status: string;
  orderDate: Date | string;
  exchangeRate: number | null;
  currency?: { code: string; symbol: string } | null;
  lines: { qty: number; unitPrice: number }[];
}

export interface FinanceEntryLike {
  id: number;
  partyType: string;
  kind: string;
  amount: number;
  currency?: string | null;
  date: Date | string;
  orderId?: number | null;
  supplierId?: number | null;
  buyerId?: number | null;
  partyName: string;
}

export interface FinanceContext {
  /** Allocated receipts per order, in that order's own currency. */
  received: Map<number, number>;
  /** Buyer money that had no outstanding order left to settle, keyed `buyerId:CCY`. */
  buyerCredit: Map<string, { buyerId: number; currency: string; amount: number }>;
  /** Jobwork accrued per order, from the board. */
  jobworkAccrued: Map<number, number>;
  /** Jobwork payments allocated back to the orders that earned them. */
  jobworkPaid: Map<number, number>;
  /** Manually billed material / wages per order, and payments allocated to them. */
  materialBilled: Map<number, number>;
  materialPaid: Map<number, number>;
  wagesBilled: Map<number, number>;
  wagesPaid: Map<number, number>;
}

const bump = (m: Map<number, number>, k: number, v: number) => m.set(k, round((m.get(k) ?? 0) + v));

/**
 * Allocate every payment across everything outstanding, once, and index the result
 * by order. `jobworkPerOrder` comes from the board (pieces cleared × rate).
 */
export function buildFinanceContext(orders: FinanceOrderLike[], entries: FinanceEntryLike[], jobworkPerOrder: Map<number, Map<number, number>>): FinanceContext {
  const ctx: FinanceContext = {
    received: new Map(),
    buyerCredit: new Map(),
    jobworkAccrued: new Map(),
    jobworkPaid: new Map(),
    materialBilled: new Map(),
    materialPaid: new Map(),
    wagesBilled: new Map(),
    wagesPaid: new Map(),
  };
  const live = orders.filter((o) => o.status !== 'Cancelled');

  // --- buyers: their orders are the debts, per currency ---------------------
  for (const buyerId of [...new Set(live.map((o) => o.buyerId))]) {
    const mine = live.filter((o) => o.buyerId === buyerId);
    const receipts = entries.filter((e) => e.partyType === 'BUYER' && e.kind === 'PAYMENT' && e.buyerId === buyerId);
    const codes = [...new Set([...mine.map((o) => o.currency?.code ?? 'INR'), ...receipts.map((r) => r.currency ?? 'INR')])];
    for (const code of codes) {
      const ordersInCcy = mine.filter((o) => (o.currency?.code ?? 'INR') === code);
      const inCcy = receipts.filter((r) => (r.currency ?? 'INR') === code);
      const buckets: Bucket[] = ordersInCcy.map((o) => ({
        key: `order-${o.id}`,
        orderId: o.id,
        label: o.number,
        date: o.orderDate,
        gross: round(o.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)),
      }));
      const result = allocateFifo(buckets, inCcy.map((e) => ({ id: e.id, date: e.date, amount: e.amount, orderId: e.orderId })));
      for (const b of result.buckets) if (b.orderId != null) ctx.received.set(b.orderId, b.paid);
      if (result.credit > 0) ctx.buyerCredit.set(`${buyerId}:${code}`, { buyerId, currency: code, amount: result.credit });
    }
  }

  // --- jobwork: accrual from the board, payments allocated oldest job first --
  for (const [vendorId, perOrder] of jobworkPerOrder) {
    for (const [orderId, amount] of perOrder) bump(ctx.jobworkAccrued, orderId, amount);
    const buckets: Bucket[] = [...perOrder.entries()]
      .map(([orderId, gross]) => {
        const o = live.find((x) => x.id === orderId);
        return { key: `order-${orderId}`, orderId, label: o?.number ?? `#${orderId}`, date: o?.orderDate ?? new Date(0), gross };
      })
      .filter((b) => b.gross > 0);
    const payments = entries.filter((e) => e.partyType === 'JOBWORK' && e.kind === 'PAYMENT' && e.supplierId === vendorId);
    const result = allocateFifo(buckets, payments.map((e) => ({ id: e.id, date: e.date, amount: e.amount, orderId: e.orderId })));
    for (const b of result.buckets) if (b.orderId != null) bump(ctx.jobworkPaid, b.orderId, b.paid);
  }

  // --- material and wages: the bills are the debts --------------------------
  for (const type of ['SUPPLIER', 'WORKER'] as const) {
    const billed = type === 'SUPPLIER' ? ctx.materialBilled : ctx.wagesBilled;
    const paid = type === 'SUPPLIER' ? ctx.materialPaid : ctx.wagesPaid;
    const rows = entries.filter((e) => e.partyType === type);
    for (const key of [...new Set(rows.map((e) => `${e.supplierId ?? e.partyName}`))]) {
      const mine = rows.filter((e) => `${e.supplierId ?? e.partyName}` === key);
      const bills = mine.filter((e) => e.kind === 'BILL');
      for (const b of bills) if (b.orderId != null) bump(billed, b.orderId, b.amount);
      const buckets: Bucket[] = bills.map((b) => ({ key: `bill-${b.id}`, orderId: b.orderId ?? null, label: `Bill #${b.id}`, date: b.date, gross: b.amount }));
      const result = allocateFifo(buckets, mine.filter((e) => e.kind === 'PAYMENT').map((e) => ({ id: e.id, date: e.date, amount: e.amount, orderId: e.orderId })));
      for (const b of result.buckets) if (b.orderId != null) bump(paid, b.orderId, b.paid);
    }
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Jobwork earned, movement by movement
// ---------------------------------------------------------------------------

export interface JobworkEvent {
  moveId: number;
  date: Date | string;
  orderId: number;
  orderNumber: string;
  orderLineId: number;
  productCode: string;
  productName: string;
  stage: string;
  stageSortOrder: number;
  vendorId: number;
  vendorName: string;
  pieces: number;
  rate: number;
  amount: number;
  note?: string | null;
  /** True when these pieces had been rejected earlier and were re-done. */
  rework: boolean;
}

interface LineForEvents {
  id: number;
  qty: number;
  product: { factoryCode: string; name: string };
  stages: (StageRow & { name: string; sortOrder: number })[];
  moves: (MoveRow & { note?: string | null })[];
}

/**
 * Every clearance out of an outsourced stage, as a dated earning.
 *
 * A vendor is paid for work done, so pieces that come back for rework and are
 * cleared again earn again — which is why this counts movements rather than
 * distinct pieces, and why the totals agree with the board's `cleared` figure.
 *
 * The rate used is the one currently on the stage. Rates are set before work is
 * handed over (an outsourced stage with no rate is refused), so this stays honest;
 * changing a rate afterwards restates the earnings for that stage.
 */
export function jobworkEvents(order: { id: number; number: string }, line: LineForEvents): JobworkEvent[] {
  const events: JobworkEvent[] = [];
  for (const { move: m, stage, rework } of clearances(line.stages, line.moves)) {
    if (!stage.vendorId) continue;
    events.push({
      moveId: m.id,
      date: m.date!,
      orderId: order.id,
      orderNumber: order.number,
      orderLineId: line.id,
      productCode: line.product.factoryCode,
      productName: line.product.name,
      stage: stage.name,
      stageSortOrder: stage.sortOrder,
      vendorId: stage.vendorId,
      vendorName: stage.vendor?.name ?? `Vendor #${stage.vendorId}`,
      pieces: m.qty,
      rate: stage.jobworkRate ?? 0,
      amount: round(m.qty * (stage.jobworkRate ?? 0)),
      note: m.note ?? null,
      rework,
    });
  }
  return events;
}

/** Convenience: the jobwork a whole order generated, as dated events. */
export function jobworkEventsForOrder(order: { id: number; number: string; lines: LineForEvents[] }): JobworkEvent[] {
  return order.lines.flatMap((l) => jobworkEvents(order, l));
}

/** Board-derived jobwork total for a line, used to cross-check the events. */
export function jobworkTotalForLine(line: LineForEvents): number {
  const board = buildBoard(line.qty, line.stages as StageRow[], line.moves as MoveRow[]);
  return round(board.jobwork.reduce((a, j) => a + j.amount, 0));
}

// ---------------------------------------------------------------------------
// Running statements
// ---------------------------------------------------------------------------

export interface StatementRow {
  /** Stable identity for the row, so the UI never keys off an array index. */
  key: string;
  date: Date | string;
  type: 'ACCRUAL' | 'BILL' | 'INVOICE' | 'PAYMENT' | 'RECEIPT';
  description: string;
  ref?: string | null;
  orderNumber?: string | null;
  /** Increases what is owed. */
  charge: number;
  /** Reduces what is owed. */
  settle: number;
  balance: number;
  detail?: string | null;
}

/** Merge charges and settlements into one dated statement with a running balance. */
export function buildStatement(rows: Omit<StatementRow, 'balance' | 'key'>[]): StatementRow[] {
  let balance = 0;
  return [...rows]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((r, i) => {
      balance = round(balance + r.charge - r.settle);
      return { ...r, key: `${r.type}-${i}-${new Date(r.date).getTime()}`, balance };
    });
}
