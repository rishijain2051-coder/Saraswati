/**
 * Shared order-board plumbing: how an order is loaded, serialized with its live
 * production board and money position, and how a line's stage snapshot is created.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';
import { ApiError } from './http';
import { round } from './costing';
import { buildBoard, impliedOrderStatus, rollUp, type LineBoard, type MoveRow, type StageRow } from './production';
import { buildFinanceContext, jobworkEvents, type FinanceContext } from './finance';

type Tx = Prisma.TransactionClient | PrismaClient;

export const orderInclude = {
  buyer: true,
  currency: true,
  proforma: { select: { id: true, number: true, status: true } },
  ledger: {
    orderBy: [{ date: 'desc' as const }, { id: 'desc' as const }],
    select: { id: true, partyType: true, kind: true, amount: true, currency: true, date: true, ref: true, note: true, partyName: true, supplierId: true, buyerId: true },
  },
  lines: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: {
        select: {
          id: true,
          factoryCode: true,
          name: true,
          stageLineId: true,
          unit: { select: { code: true } },
          images: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      stageLine: { select: { id: true, code: true, name: true } },
      sheet: { select: { id: true, number: true } },
      stages: { orderBy: { sortOrder: 'asc' as const }, include: { vendor: { select: { id: true, name: true } } } },
      moves: {
        orderBy: [{ date: 'desc' as const }, { id: 'desc' as const }],
        include: { photos: { orderBy: { sortOrder: 'asc' as const }, select: { id: true, url: true, caption: true } } },
      },
    },
  },
};

export type OrderWithBoard = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Live board for one loaded order line. */
export function boardForLine(line: { qty: number; stages: StageRow[]; moves: MoveRow[] }): LineBoard {
  return buildBoard(line.qty, line.stages as StageRow[], line.moves as MoveRow[]);
}

/** Attach boards, totals and the money position to an order payload for the API. */
export function serializeOrder(o: OrderWithBoard, ctx: FinanceContext) {
  const lines = o.lines.map((l) => {
    const board = boardForLine(l as any);
    const vendors = board.stages.filter((s) => s.vendorId).map((s) => ({ id: s.vendorId!, name: s.vendor?.name ?? `Vendor #${s.vendorId}`, stage: s.name, sortOrder: s.sortOrder }));
    const distinctVendors = Array.from(new Map(vendors.map((v) => [v.id, { id: v.id, name: v.name }])).values());
    return {
      ...l,
      product: { ...l.product, primaryImage: l.product.images?.[0]?.url ?? null, images: undefined },
      amount: round(l.qty * l.unitPrice),
      needsStageLine: l.stages.length === 0,
      /** Where the work happens: purely derived from who owns each stage. */
      outsourcedStages: vendors,
      vendors: distinctVendors,
      mode: distinctVendors.length === 0 ? 'INHOUSE' : vendors.length === board.stages.length ? 'OUTSOURCED' : 'MIXED',
      board,
      history: l.moves.map((m) => ({
        id: m.id,
        kind: m.kind,
        fromStageId: m.fromStageId,
        toStageId: m.toStageId,
        fromStage: m.fromStageId != null ? l.stages.find((s) => s.id === m.fromStageId)?.name ?? null : null,
        toStage: m.toStageId != null ? l.stages.find((s) => s.id === m.toStageId)?.name ?? null : null,
        qty: m.qty,
        date: m.date,
        note: m.note,
        photos: m.photos,
      })),
      moves: undefined,
    };
  });

  const summary = rollUp(lines.map((l) => l.board));

  // Jobwork accrued so far, merged across every line of the order.
  const jobwork = new Map<number, { vendorId: number; vendorName: string; pieces: number; amount: number; stages: string[] }>();
  for (const l of lines) {
    for (const j of l.board.jobwork) {
      const row = jobwork.get(j.vendorId) ?? { vendorId: j.vendorId, vendorName: j.vendorName, pieces: 0, amount: 0, stages: [] };
      row.pieces += j.pieces;
      row.amount = round(row.amount + j.amount);
      for (const s of j.stages) if (!row.stages.includes(s)) row.stages.push(s);
      jobwork.set(j.vendorId, row);
    }
  }
  const jobworkList = Array.from(jobwork.values());

  const total = round(lines.reduce((s, l) => s + l.amount, 0));
  return {
    ...o,
    lines,
    total,
    summary,
    jobwork: jobworkList,
    money: orderMoney(o, total, ctx),
  };
}

/**
 * Build the shared money context for a set of orders. Loads every order of the
 * buyers involved plus the whole ledger, because a payment on one order can settle
 * another — you cannot work out one order's position in isolation.
 */
export async function financeContextFor(orders: { buyerId: number }[]): Promise<FinanceContext> {
  const buyerIds = [...new Set(orders.map((o) => o.buyerId))];
  const [related, entries] = await Promise.all([
    prisma.order.findMany({
      where: { OR: [{ buyerId: { in: buyerIds } }, { ledger: { some: {} } }] },
      select: {
        id: true,
        number: true,
        buyerId: true,
        status: true,
        orderDate: true,
        exchangeRate: true,
        currency: { select: { code: true, symbol: true } },
        lines: { select: { qty: true, unitPrice: true, stages: { include: { vendor: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' } }, moves: true, product: { select: { factoryCode: true, name: true } }, id: true } },
      },
    }),
    prisma.ledgerEntry.findMany({ orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
  ]);

  // Jobwork accrued per vendor per order, straight off each board.
  const jobwork = new Map<number, Map<number, number>>();
  for (const o of related) {
    for (const l of o.lines) {
      for (const e of jobworkEvents({ id: o.id, number: o.number }, l as never)) {
        const perOrder = jobwork.get(e.vendorId) ?? new Map<number, number>();
        perOrder.set(o.id, round((perOrder.get(o.id) ?? 0) + e.amount));
        jobwork.set(e.vendorId, perOrder);
      }
    }
  }
  return buildFinanceContext(related as never, entries as never, jobwork);
}

/**
 * The money position of one order. Every figure comes from the shared finance
 * context, which allocates payments FIFO across everything outstanding — so a
 * receipt that rolled onto another order shows the same number here as it does on
 * the Payments page. Never recompute this from `order.ledger` alone: rows booked to
 * an order are only where a payment was *aimed*, not where it landed.
 */
export function orderMoney(
  o: { id: number; currency?: { code: string; symbol: string } | null; exchangeRate?: number | null; status: string },
  total: number,
  ctx: FinanceContext
) {
  const at = (m: Map<number, number>) => round(m.get(o.id) ?? 0);

  const invoiced = o.status === 'Cancelled' ? 0 : total;
  const received = at(ctx.received);
  const jobworkAccrued = at(ctx.jobworkAccrued);
  const jobworkPaid = at(ctx.jobworkPaid);
  const materialBilled = at(ctx.materialBilled);
  const materialPaid = at(ctx.materialPaid);
  const wagesBilled = at(ctx.wagesBilled);
  const wagesPaid = at(ctx.wagesPaid);

  const rate = o.exchangeRate ?? 1;
  return {
    currency: o.currency?.code ?? 'INR',
    symbol: o.currency?.symbol ?? '₹',
    exchangeRate: rate,
    invoiced: round(invoiced),
    received: round(received),
    receivable: round(invoiced - received),
    /** Order value in rupees, at the rate snapshotted when the order was made. */
    invoicedInr: round(invoiced * rate),
    receivableInr: round((invoiced - received) * rate),
    jobworkAccrued,
    jobworkPaid: round(jobworkPaid),
    jobworkDue: round(jobworkAccrued - jobworkPaid),
    materialBilled: round(materialBilled),
    materialPaid: round(materialPaid),
    materialDue: round(materialBilled - materialPaid),
    wagesBilled: round(wagesBilled),
    wagesPaid: round(wagesPaid),
    wagesDue: round(wagesBilled - wagesPaid),
    payableInr: round(jobworkAccrued - jobworkPaid + (materialBilled - materialPaid) + (wagesBilled - wagesPaid)),
  };
}

export async function loadOrder(id: number) {
  const o = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!o) throw new ApiError(404, 'Order not found.');
  return o;
}

export async function loadSerializedOrder(id: number) {
  const o = await loadOrder(id);
  return serializeOrder(o, await financeContextFor([o]));
}

/** Serialize many orders sharing one money context, so the list stays consistent. */
export async function serializeOrders(orders: OrderWithBoard[]) {
  const ctx = await financeContextFor(orders);
  return orders.map((o) => serializeOrder(o, ctx));
}

/**
 * Move the order status along if the board says so (Confirmed -> Production ->
 * Ready). Shipped / Closed / Cancelled are human decisions and never touched.
 */
export async function syncOrderStatus(tx: Tx, orderId: number): Promise<string | null> {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { lines: { include: { stages: true, moves: true } } } });
  if (!order) return null;
  const summary = rollUp(order.lines.map((l) => boardForLine(l as any)));
  const next = impliedOrderStatus(order.status, summary);
  if (!next) return null;
  await tx.order.update({ where: { id: orderId }, data: { status: next } });
  return next;
}

/** The stage line a product should use: its own, else the master default. */
export async function resolveStageLineId(tx: Tx, productId: number): Promise<number | null> {
  const product = await tx.product.findUnique({ where: { id: productId }, select: { stageLineId: true } });
  if (product?.stageLineId) return product.stageLineId;
  const fallback = await tx.stageLine.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
  return fallback?.id ?? null;
}

/**
 * Create (or recreate) an order line's stage snapshot from its stage line. Stages
 * start in-house; who does what is set per stage afterwards.
 *
 * Refuses to wipe stages once pieces have started moving — history is sacred.
 */
export async function materializeStages(tx: Tx, orderLineId: number, stageLineId: number | null): Promise<number> {
  const moveCount = await tx.stageMove.count({ where: { orderLineId } });
  if (moveCount > 0) {
    throw new ApiError(409, 'This line already has production movements — undo them before changing its stage line.');
  }
  await tx.orderLineStage.deleteMany({ where: { orderLineId } });
  if (!stageLineId) return 0;

  const steps = await tx.stageLineStep.findMany({ where: { stageLineId }, orderBy: { sortOrder: 'asc' } });
  for (let i = 0; i < steps.length; i++) {
    await tx.orderLineStage.create({ data: { orderLineId, name: steps[i].name, sortOrder: i } });
  }
  return steps.length;
}
