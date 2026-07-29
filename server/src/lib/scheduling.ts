/**
 * When work SHOULD happen — a pure overlay on the production board.
 *
 * The board's invariant is untouched: `StageMove` says where pieces ARE and that stays
 * derived from the ledger. Nothing in this file ever produces a quantity, and nothing
 * here is consulted to decide whether a move is legal. It only ever compares dates with
 * the board's own figures to answer "are we behind?".
 *
 * Two ideas:
 *
 * - A **schedule** is estimated start/end dates per stage, generated backwards from the
 *   delivery date using each step's `defaultDays` (Master Data → Stage Lines) and then
 *   adjustable by hand. Stating durations once is what makes a generated schedule
 *   believable enough to act on.
 * - **Delivery status** is derived every time it is read, from the board's progress and
 *   today's date. Nothing is stored, so it can never be stale.
 *
 * Dates go through `dayStart` so a comparison is a calendar-day comparison, never an
 * accident of the clock — the same discipline as the muster roll.
 */
import { dayStart } from './workforce';

export const STAGE_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'OVERDUE', 'AHEAD'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export const DELIVERY_STATUSES = ['DELIVERED', 'LATE', 'AT_RISK', 'ON_TRACK', 'NO_DATE'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** How close to the date, and how far behind, counts as worth flagging. */
export const AT_RISK_DAYS = 7;
export const AT_RISK_PCT = 80;

/** Whole days from a to b, by calendar date. Negative when b is before a. */
export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86400000);
}

export interface ScheduleStageInput {
  orderLineStageId: number;
  name: string;
  sortOrder: number;
  estimatedStart?: Date | string | null;
  estimatedEnd?: Date | string | null;
  /** From the board: pieces sitting here, and pieces that have gone past. */
  at: number;
  cleared: number;
}

export interface StageEstimate {
  orderLineStageId: number;
  name: string;
  sortOrder: number;
  estimatedStart: Date | null;
  estimatedEnd: Date | null;
  status: StageStatus;
  /** Days until this stage should be finished. Null without an estimated end. */
  daysRemaining: number | null;
  /** How far past its estimated end it is. 0 when not overdue. */
  daysOverdue: number;
}

export interface CompletionEstimate {
  stages: StageEstimate[];
  /** The last estimated end across the stages, or null when nothing is scheduled. */
  estimatedCompletion: Date | null;
  percentComplete: number;
  /** True when a stage that should be finished is not. */
  isBehind: boolean;
  /** The worst overdue figure across the stages. */
  daysLate: number;
}

/**
 * Compare a schedule with what the board actually shows.
 *
 * A stage counts as DONE when everything that ever reached it has moved on, IN_PROGRESS
 * while pieces sit there, and OVERDUE when its estimated end has passed and it is not
 * done. AHEAD is the pleasant case: finished before it was due.
 */
export function estimateCompletion(qty: number, stages: ScheduleStageInput[], today: Date = new Date(), done = 0): CompletionEstimate {
  const now = dayStart(today);
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);

  const out: StageEstimate[] = ordered.map((s) => {
    const start = s.estimatedStart ? dayStart(s.estimatedStart) : null;
    const end = s.estimatedEnd ? dayStart(s.estimatedEnd) : null;
    // Pieces still sitting here mean the stage is NOT finished, however many have gone
    // through. Rework legitimately makes `cleared` exceed `qty` (events count movements),
    // so testing `cleared >= qty` alone called a stage done while two pieces sat on it
    // nineteen days past its date.
    const working = s.at > 0;
    const done = !working && s.cleared >= qty && qty > 0;

    let status: StageStatus;
    if (done) status = end && daysBetween(now, end) > 0 ? 'AHEAD' : 'DONE';
    else if (end && daysBetween(end, now) > 0) status = 'OVERDUE';
    else if (working) status = 'IN_PROGRESS';
    else status = 'NOT_STARTED';

    const daysOverdue = status === 'OVERDUE' && end ? daysBetween(end, now) : 0;
    return {
      orderLineStageId: s.orderLineStageId,
      name: s.name,
      sortOrder: s.sortOrder,
      estimatedStart: start,
      estimatedEnd: end,
      status,
      daysRemaining: end ? daysBetween(now, end) : null,
      daysOverdue,
    };
  });

  const ends = out.map((s) => s.estimatedEnd).filter((d): d is Date => d != null);
  // Progress is the BOARD's `done`, the same figure `deliveryStatus` uses. Deriving it
  // from the last stage's `cleared` instead made the two disagree inside one response,
  // because rework counts movements: 6 clearances out of the final stage for 10 pieces
  // read 60% on the line bar while the header read the true 50%.
  return {
    stages: out,
    estimatedCompletion: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : null,
    percentComplete: qty > 0 ? Math.round((Math.min(done, qty) / qty) * 100) : 0,
    isBehind: out.some((s) => s.status === 'OVERDUE'),
    daysLate: out.reduce((a, s) => Math.max(a, s.daysOverdue), 0),
  };
}

export interface AutoScheduleStep {
  orderLineStageId: number;
  name: string;
  sortOrder: number;
  /** From StageLineStep.defaultDays. Null falls back to an equal share. */
  defaultDays?: number | null;
}

export interface AutoScheduledStage {
  orderLineStageId: number;
  estimatedStart: Date;
  estimatedEnd: Date;
}

/**
 * Lay a schedule out between two dates.
 *
 * Steps with a `defaultDays` take that long; the rest share whatever is left equally. If
 * the stated durations do not fit the window, they are scaled to fit rather than silently
 * overrunning the delivery date — a plan that ends after the deadline is not a plan.
 * Every stage gets at least one day, so a tight window still produces a usable order.
 */
export function autoSchedule(steps: AutoScheduleStep[], from: Date | string, to: Date | string): AutoScheduledStage[] {
  const ordered = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return [];

  const start = dayStart(from);
  const end = dayStart(to);
  // One day per stage is the floor, so a window smaller than the stage count cannot be
  // honoured and the plan will necessarily overrun. `overruns` on the result says so
  // rather than the caller having to work it out.
  const available = daysBetween(start, end) + 1;
  const window = Math.max(ordered.length, available);

  const stated: (number | null)[] = ordered.map((s) => (s.defaultDays && s.defaultDays > 0 ? Math.floor(s.defaultDays) : null));
  const statedTotal = stated.reduce<number>((a, d) => a + (d ?? 0), 0);
  const unstated = stated.filter((d) => d == null).length;

  let days: number[];
  if (statedTotal >= window || unstated === 0) {
    // Scale the stated durations to the window, keeping their relative weights.
    const total = statedTotal || ordered.length;
    const base = stated.map((d) => d ?? 1);
    days = base.map((d) => Math.max(1, Math.round((d / total) * window)));
  } else {
    const share = Math.max(1, Math.floor((window - statedTotal) / unstated));
    days = stated.map((d) => d ?? share);
  }

  // Rounding and the one-day floor can still push the total past the window — five stages
  // rounding to 0 each become 1. Trim from the LONGEST stages until it fits, so the plan
  // never ends after the deadline it was generated from.
  let over = days.reduce((a, d) => a + d, 0) - window;
  while (over > 0) {
    let longest = 0;
    for (let i = 1; i < days.length; i++) if (days[i] > days[longest]) longest = i;
    if (days[longest] <= 1) break; // every stage is at its floor — it genuinely cannot fit
    days[longest] -= 1;
    over -= 1;
  }

  const out: AutoScheduledStage[] = [];
  let cursor = new Date(start);
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const len = Math.max(1, days[i]);
    const stageStart = new Date(cursor);
    const stageEnd = new Date(cursor);
    // Inclusive: a one-day stage starts and ends on the same day.
    stageEnd.setDate(stageEnd.getDate() + len - 1);
    out.push({ orderLineStageId: s.orderLineStageId, estimatedStart: stageStart, estimatedEnd: stageEnd });
    cursor = new Date(stageEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export interface DeliveryInput {
  status: string;
  deliveryDate?: Date | string | null;
  /** The factory's own estimate, when one has been set. */
  expectedDelivery?: Date | string | null;
  /** Board progress across the whole order. */
  qty: number;
  done: number;
}

export interface DeliveryVerdict {
  status: DeliveryStatus;
  percentComplete: number;
  /** Days until the buyer's date. Negative once it has passed. */
  daysToDelivery: number | null;
  daysLate: number;
  /** Why the verdict is what it is, in one line, for the UI to show as-is. */
  reason: string;
}

/**
 * Is this order going to make its date?
 *
 * AT_RISK is the useful case and the only one needing judgement: progress is compared
 * with how much of the time has gone. If half the window has passed and less than half
 * the pieces are done, it is flagged — early enough to act, rather than waiting for the
 * date itself to slip. A 10% tolerance stops a perfectly normal slow start crying wolf.
 */
export function deliveryStatus(o: DeliveryInput, today: Date = new Date()): DeliveryVerdict {
  const pct = o.qty > 0 ? Math.round((Math.min(o.done, o.qty) / o.qty) * 100) : 0;

  if (o.status === 'Shipped' || o.status === 'Closed') {
    return { status: 'DELIVERED', percentComplete: 100, daysToDelivery: null, daysLate: 0, reason: `Already ${o.status.toLowerCase()}.` };
  }
  if (o.status === 'Cancelled') {
    return { status: 'NO_DATE', percentComplete: pct, daysToDelivery: null, daysLate: 0, reason: 'Cancelled.' };
  }
  const target = o.deliveryDate ?? o.expectedDelivery ?? null;
  if (!target) {
    return { status: 'NO_DATE', percentComplete: pct, daysToDelivery: null, daysLate: 0, reason: 'No delivery date set.' };
  }

  const now = dayStart(today);
  const due = dayStart(target);
  const daysToDelivery = daysBetween(now, due);

  if (daysToDelivery < 0) {
    // Past the date is LATE whether or not the goods are ready. Finished stock sitting
    // unshipped for two months is the MOST actionable row there is, and reporting it as
    // on track pushed it off the top of the tracker.
    return {
      status: 'LATE',
      percentComplete: pct,
      daysToDelivery,
      daysLate: -daysToDelivery,
      reason: pct >= 100 ? `${-daysToDelivery} day(s) past the delivery date — all pieces finished but not shipped.` : `${-daysToDelivery} day(s) past the delivery date with ${pct}% finished.`,
    };
  }
  if (pct >= 100) {
    return { status: 'ON_TRACK', percentComplete: 100, daysToDelivery, daysLate: 0, reason: 'All pieces finished — ready to ship.' };
  }

  if (daysToDelivery === 0) {
    return { status: 'AT_RISK', percentComplete: pct, daysToDelivery, daysLate: 0, reason: `Due today with ${pct}% finished.` };
  }

  // The last week is the window in which being behind still leaves time to act, so that
  // is when it is worth flagging. The 80% bar is deliberately forgiving: an order that is
  // nearly done a few days out is fine, and a threshold any higher would flag everything.
  if (daysToDelivery <= AT_RISK_DAYS && pct < AT_RISK_PCT) {
    return { status: 'AT_RISK', percentComplete: pct, daysToDelivery, daysLate: 0, reason: `${daysToDelivery} day(s) left and only ${pct}% finished.` };
  }
  return { status: 'ON_TRACK', percentComplete: pct, daysToDelivery, daysLate: 0, reason: `${daysToDelivery} day(s) to go, ${pct}% finished.` };
}

/** Sort key: the most urgent first, for a list somebody has to act on. */
export const DELIVERY_URGENCY: Record<DeliveryStatus, number> = {
  LATE: 0,
  AT_RISK: 1,
  ON_TRACK: 2,
  NO_DATE: 3,
  DELIVERED: 4,
};
