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
import { buildBoard, type MoveRow, type StageRow } from './production';

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
  const stageById = new Map(line.stages.map((s) => [s.id, s]));
  const events: JobworkEvent[] = [];
  const clearedSoFar = new Map<number, number>();
  const rejectedFrom = new Map<number, number>();

  // Walk oldest-first so "was this a re-do?" can be answered as we go.
  const chronological = [...line.moves].sort((a, b) => byDate({ date: a.date!, id: a.id }, { date: b.date!, id: b.id }));
  for (const m of chronological) {
    if (m.kind === 'REJECT' && m.fromStageId != null) {
      rejectedFrom.set(m.fromStageId, (rejectedFrom.get(m.fromStageId) ?? 0) + m.qty);
    }
    if (m.kind !== 'ADVANCE' && m.kind !== 'COMPLETE') continue;
    if (m.fromStageId == null) continue;
    const stage = stageById.get(m.fromStageId);
    if (!stage?.vendorId) continue;

    const already = clearedSoFar.get(stage.id) ?? 0;
    clearedSoFar.set(stage.id, already + m.qty);

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
      rework: already + m.qty > line.qty,
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
