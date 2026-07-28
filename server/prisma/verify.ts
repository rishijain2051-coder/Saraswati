/**
 * Self-checks that need no database state.
 *
 *   npm run verify
 *
 * The costing engine was reverse-engineered from `example.xlsx` (the "Crazy Almirah",
 * FOB ₹19,180.60). That workbook is the only external authority for the formulas, so
 * the check lives here as fixed numbers rather than depending on a seeded demo
 * product that any wipe would take away.
 *
 * The board and allocation invariants are checked the same way: pure functions, fixed
 * inputs, expected outputs.
 */
import { BUILTIN_METHODS, round, suggestCostDim, type MethodMap } from '../src/lib/costing';
import { computeCostSheet } from '../src/lib/productCosting';
import { rowToMethodDef } from '../src/lib/methods';
import { buildBoard, expandHops, validateMove, type MoveRow, type StageRow } from '../src/lib/production';
import { allocateFifo, buildStatement, jobworkEvents, type Bucket } from '../src/lib/finance';
import {
  DEFAULT_RULES,
  accrualStart,
  attendanceEarnings,
  computeStatutory,
  dayKey,
  dayStart,
  monthKey,
  isWorkingDay,
  labourEvents,
  monthlyPerDay,
  parseWeeklyOffDays,
  recoverAdvances,
  validateMoveWorkers,
  wageBase,
  workerPosition,
  workingDaysInMonth,
  type EarningEvent,
  type WorkforceRules,
} from '../src/lib/workforce';
import { assemble, normalizeKey, outlier, summarize, windowStart, type Occurrence } from '../src/lib/suggest';

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`}`);
  if (!ok) failed++;
}

// The built-in formulas, without touching the CostMethod table.
const methods: MethodMap = Object.fromEntries(BUILTIN_METHODS.map((m) => [m.code, rowToMethodDef(m as never)]));

const L = (name: string, o: Record<string, unknown>) => ({ name, qty: 1, wastagePct: 0, rate: 0, ...o });

// ---------------------------------------------------------------------------
// 1. Costing — the Crazy Almirah from example.xlsx
// ---------------------------------------------------------------------------

const crazyAlmirah = {
  currency: { code: 'INR', symbol: '₹' },
  factoryExpensePct: 15,
  marginPct: 15,
  groups: [
    {
      head: 'MAIN_COMPONENT',
      name: 'Mango Wood',
      method: 'CFT',
      dimUnit: 'IN',
      lines: [
        L('TOP', { actualL: 25, actualW: 32, actualH: 1, costL: 27, costW: 38.4, costH: 1, qty: 1, wastagePct: 20, rate: 560, unit: 'CFT' }),
        L('SIDE', { actualL: 59, actualW: 15, actualH: 1, costL: 63, costW: 18, costH: 1, qty: 2, wastagePct: 20, rate: 760, unit: 'CFT' }),
        L('PARTITION', { actualL: 56, actualW: 16, actualH: 1, costL: 60, costW: 19.2, costH: 1, qty: 1, wastagePct: 20, rate: 760, unit: 'CFT' }),
        L('SHELF', { actualL: 14, actualW: 17, actualH: 1, costL: 18, costW: 20.4, costH: 1, qty: 4, wastagePct: 20, rate: 560, unit: 'CFT' }),
        L('BOTTOM', { actualL: 24, actualW: 16, actualH: 1, costL: 27, costW: 19.2, costH: 1, qty: 1, wastagePct: 20, rate: 560, unit: 'CFT' }),
        L('DOOR FRAME', { actualL: 56, actualW: 13, actualH: 1.5, costL: 60, costW: 15.6, costH: 1.5, qty: 1, wastagePct: 20, rate: 760, unit: 'CFT' }),
      ],
    },
    { head: 'MAIN_COMPONENT', name: 'Oak Wood', method: 'SQFT', dimUnit: 'IN', lines: [L('DOOR PANEL', { actualL: 34, actualW: 16, costL: 36, costW: 19.2, qty: 1, wastagePct: 20, rate: 490, unit: 'SQFT' })] },
    { head: 'SUB_COMPONENT', name: 'Iron — Powdercoated Fitting', method: 'WEIGHT', lines: [L('PWDRFTG/133', { actualWeight: 14.38, wastagePct: 4.31, qty: 1, rate: 182, unit: 'KGS' })] },
    { head: 'SUB_COMPONENT', name: 'Iron — Powdercoated Legs', method: 'QTY', lines: [L('PWDRCTDLGS/1452', { qty: 1, rate: 1200, unit: 'PCS' })] },
    {
      head: 'SUB_COMPONENT',
      name: 'Ply 6mm',
      method: 'SQFT',
      dimUnit: 'IN',
      lines: [L('BACK PLY', { actualL: 18, actualW: 32, costL: 18, costW: 32, qty: 2, rate: 30, unit: 'SQFT' }), L('BOTTOM PLY', { actualL: 19, actualW: 12, costL: 19, costW: 12, qty: 5, rate: 30, unit: 'SQFT' })],
    },
    { head: 'SUB_COMPONENT', name: 'Ply 8mm', method: 'SQMT', dimUnit: 'CM', lines: [L('BOTTOM SUPPORT', { actualL: 42, actualW: 30, costL: 42, costW: 30, qty: 1, rate: 960, unit: 'SQM' })] },
    { head: 'SUB_COMPONENT', name: 'Glass 4mm', method: 'SQFT', dimUnit: 'IN', lines: [L('DOOR GLASS', { actualL: 12, actualW: 18, costL: 12, costW: 18, qty: 1, rate: 130, unit: 'SQFT' })] },
    {
      head: 'HARDWARE',
      name: 'Hardware',
      method: 'QTY',
      lines: [
        L("11' HANDLE", { qty: 2, rate: 63, unit: 'PCS' }),
        L("1.5' SCREW", { qty: 30, rate: 0.82, unit: 'PCS' }),
        L('F35 NAILS', { qty: 2, rate: 50, unit: 'SET' }),
        L("2' BRASS KNOB", { qty: 1, rate: 112, unit: 'PCS' }),
        L('60N PAPER', { qty: 3, rate: 58, unit: 'PCS' }),
        L('120N PAPER', { qty: 3, rate: 39, unit: 'PCS' }),
        L("10' CHAIN", { qty: 1, rate: 12, unit: 'PCS' }),
      ],
    },
    {
      head: 'POLISHING',
      name: 'Polishing',
      method: 'QTY',
      lines: [
        L('THINNER', { qty: 2, rate: 25, unit: 'LTR' }),
        L('SEALER', { qty: 2, rate: 28, unit: 'LTR' }),
        L('LACQUER', { qty: 2, rate: 30, unit: 'LTR' }),
        L('ROUGH CLOTH', { qty: 2, rate: 7, unit: 'PCS' }),
        L('SANDING PAPER', { qty: 1.5, rate: 80, unit: 'PCS' }),
      ],
    },
    {
      head: 'PACKAGING',
      name: 'Packaging',
      method: 'QTY',
      lines: [L('BUBBLE', { qty: 0.88, rate: 230, unit: 'MTR' }), L('FOAM', { qty: 0.78, rate: 210, unit: 'MTR' }), L('CARTON 7PLY', { qty: 1, rate: 580, unit: 'PCS' }), L('CORNERS', { qty: 8, rate: 2.8, unit: 'PCS' })],
    },
    {
      head: 'LABOUR',
      name: 'Labour',
      method: 'QTY',
      lines: [
        L('CNC LABOUR', { qty: 1, rate: 100, unit: 'LOT' }),
        L('CARVING LABOUR', { qty: 1, rate: 260, unit: 'LOT' }),
        L('MANUFACTURING LABOUR', { qty: 1, rate: 500, unit: 'LOT' }),
        L('POLISHING LABOUR', { qty: 1, rate: 428, unit: 'LOT' }),
        L('PACKAGING LABOUR', { qty: 1, rate: 180, unit: 'LOT' }),
        L('LOADING LABOUR', { qty: 1, rate: 110, unit: 'LOT' }),
      ],
    },
    { head: 'FORWARDING', name: 'Forwarding', method: 'QTY', lines: [L('CHA', { qty: 1, rate: 98, unit: 'LOT' }), L('FORWARDER', { qty: 1, rate: 580, unit: 'LOT' }), L('ICD', { qty: 1, rate: 136, unit: 'LOT' })] },
  ],
};

const computed = computeCostSheet(crazyAlmirah as never, methods) as any;
console.log('\n--- costing engine, against example.xlsx ---');
check('FOB per piece', round(computed.summary.fob), 19180.6);
check('Ex-factory excludes forwarding', round(computed.summary.exFactory), round(computed.summary.headTotals.MAIN_COMPONENT + computed.summary.headTotals.SUB_COMPONENT + computed.summary.headTotals.HARDWARE + computed.summary.headTotals.POLISHING + computed.summary.headTotals.PACKAGING + computed.summary.headTotals.LABOUR));
check('Non-FOB is FOB less the forwarding roll-up', computed.summary.nonFob < computed.summary.fob, true);
check('TOP measures 6 CFT at 10 pcs', round(computed.groups[0].lines[0].measure * 10, 3), 6);

// ---------------------------------------------------------------------------
// 2. Board arithmetic
// ---------------------------------------------------------------------------

const stages: StageRow[] = ['Raw joining', 'Raw sanding', 'Polishing', 'QC', 'Packing'].map((name, i) => ({
  id: i + 1,
  name,
  sortOrder: i,
  vendorId: i === 2 ? 99 : null,
  jobworkRate: i === 2 ? 40 : 0,
  vendor: i === 2 ? { id: 99, name: 'Polish Co.' } : null,
}));
const mv = (id: number, kind: string, from: number | null, to: number | null, qty: number, day = 1): MoveRow => ({ id, kind, fromStageId: from, toStageId: to, qty, date: new Date(2026, 0, day) });

console.log('\n--- production board ---');
let board = buildBoard(10, stages, [mv(1, 'RELEASE', null, 1, 10)]);
check('release fills stage 1', [board.pending, board.stages[0].at, board.wip, board.done], [0, 10, 10, 0]);

board = buildBoard(10, stages, [mv(1, 'RELEASE', null, 1, 10), mv(2, 'ADVANCE', 1, 2, 6), mv(3, 'ADVANCE', 2, 3, 6), mv(4, 'ADVANCE', 3, 4, 6)]);
check('pieces land where sent', [board.stages[0].at, board.stages[3].at], [4, 6]);
check('jobwork accrues only on the vendor stage', board.jobwork, [{ vendorId: 99, vendorName: 'Polish Co.', stages: ['Polishing'], pieces: 6, amount: 240 }]);
check('pieces are conserved', board.pending + board.wip + board.done, 10);

board = buildBoard(10, stages, [mv(1, 'RELEASE', null, 1, 10), mv(2, 'ADVANCE', 1, 4, 10), mv(3, 'REJECT', 4, 3, 4), mv(4, 'COMPLETE', 4, null, 6)]);
check('rejection sends pieces back', board.stages[2].at, 4);
check('completion empties into done', board.done, 6);
check('rework is still conserved', board.pending + board.wip + board.done, 10);

console.log('\n--- move rules ---');
check('cannot over-move', validateMove(board, { kind: 'ADVANCE', fromStageId: 3, toStageId: 4, qty: 99 }), 'Only 4 pc(s) available at Polishing.');
check('cannot advance backwards', validateMove(board, { kind: 'ADVANCE', fromStageId: 3, toStageId: 2, qty: 1 }), 'Advancing must move forward — use "send back" to return pieces to an earlier stage.');
check('cannot reject forwards', validateMove(board, { kind: 'REJECT', fromStageId: 3, toStageId: 4, qty: 1 }), 'Sending back must move to an earlier stage.');
check('cannot release into nothing', validateMove(board, { kind: 'RELEASE', toStageId: null, qty: 1 }), 'Pick the stage to release pieces into.');
check('a legal move passes', validateMove(board, { kind: 'ADVANCE', fromStageId: 3, toStageId: 4, qty: 4 }), null);

console.log('\n--- multi-step clearance ---');
const full = buildBoard(10, stages, [mv(1, 'RELEASE', null, 1, 10)]);
check('advancing 1 -> 4 records three hops', expandHops(full, { kind: 'ADVANCE', fromStageId: 1, toStageId: 4, qty: 5 }).map((h) => [h.fromStageId, h.toStageId]), [[1, 2], [2, 3], [3, 4]]);
check('a single-stage advance stays one hop', expandHops(full, { kind: 'ADVANCE', fromStageId: 1, toStageId: 2, qty: 5 }).length, 1);
check('finishing early never walks the line', expandHops(full, { kind: 'COMPLETE', fromStageId: 1, toStageId: null, qty: 5 }), [{ kind: 'COMPLETE', fromStageId: 1, toStageId: null, qty: 5 }]);
check('rejection is one event', expandHops(full, { kind: 'REJECT', fromStageId: 4, toStageId: 1, qty: 2 }).length, 1);

// Finishing early must not credit the vendor whose stage was skipped.
const skipped = buildBoard(10, stages, [mv(1, 'RELEASE', null, 1, 10), mv(2, 'COMPLETE', 1, null, 10)]);
check('skipped vendor stage earns nothing', skipped.jobwork, []);

// ---------------------------------------------------------------------------
// 3. Jobwork events
// ---------------------------------------------------------------------------

console.log('\n--- jobwork history ---');
const line = {
  id: 1,
  qty: 10,
  product: { factoryCode: 'AB-1', name: 'Test' },
  stages: stages as never,
  moves: [mv(1, 'RELEASE', null, 1, 10, 1), mv(2, 'ADVANCE', 1, 3, 10, 2), mv(3, 'ADVANCE', 3, 4, 6, 3), mv(4, 'REJECT', 4, 3, 2, 4), mv(5, 'ADVANCE', 3, 4, 2, 5)] as never,
};
const events = jobworkEvents({ id: 1, number: 'ORD-1' }, line as never);
check('one earning per clearance out of the vendor stage', events.length, 2);
check('earnings equal pieces x rate', events.map((e) => e.amount), [240, 80]);
check('the re-done clearance is flagged', events.map((e) => e.rework), [false, true]);
check('events reconcile with the board', round(events.reduce((a, e) => a + e.amount, 0)), buildBoard(10, stages, line.moves as never).jobwork[0].amount);

// ---------------------------------------------------------------------------
// 4. FIFO allocation
// ---------------------------------------------------------------------------

console.log('\n--- FIFO allocation ---');
const buckets: Bucket[] = [
  { key: 'o1', orderId: 1, label: 'ORD-1', date: new Date(2026, 0, 1), gross: 1000 },
  { key: 'o2', orderId: 2, label: 'ORD-2', date: new Date(2026, 0, 10), gross: 2000 },
  { key: 'o3', orderId: 3, label: 'ORD-3', date: new Date(2026, 0, 20), gross: 3000 },
];
let alloc = allocateFifo(buckets, [{ id: 1, date: new Date(2026, 1, 1), amount: 2500, orderId: 1 }]);
check('names its order first, then spills to the next oldest', alloc.payments[0].allocations.map((a) => [a.label, a.amount]), [['ORD-1', 1000], ['ORD-2', 1500]]);
check('balances left behind', alloc.buckets.map((b) => b.balance), [0, 500, 3000]);
check('nothing on account yet', alloc.credit, 0);

alloc = allocateFifo(buckets, [{ id: 1, date: new Date(2026, 1, 1), amount: 7000 }]);
check('a payment with no order works oldest-first', alloc.buckets.map((b) => b.balance), [0, 0, 0]);
check('the surplus becomes credit', alloc.credit, 1000);

alloc = allocateFifo(buckets, [{ id: 1, date: new Date(2026, 1, 1), amount: 500, orderId: 3 }]);
check('a stated order is honoured over age', alloc.buckets.map((b) => b.balance), [1000, 2000, 2500]);

alloc = allocateFifo([], [{ id: 1, date: new Date(2026, 1, 1), amount: 900 }]);
check('with nothing outstanding it is all credit', alloc.credit, 900);

alloc = allocateFifo(buckets, [
  { id: 1, date: new Date(2026, 1, 1), amount: 400 },
  { id: 2, date: new Date(2026, 1, 2), amount: 900 },
]);
check('two payments queue in date order', alloc.buckets.map((b) => b.paid), [1000, 300, 0]);

console.log('\n--- statement ---');
const st = buildStatement([
  { date: new Date(2026, 0, 1), type: 'INVOICE', description: 'Order', charge: 1000, settle: 0 },
  { date: new Date(2026, 0, 5), type: 'RECEIPT', description: 'Receipt', charge: 0, settle: 400 },
  { date: new Date(2026, 0, 9), type: 'INVOICE', description: 'Order', charge: 500, settle: 0 },
]);
check('running balance walks the rows', st.map((r) => r.balance), [1000, 600, 1100]);
check('rows carry a stable key', st.every((r) => typeof r.key === 'string' && r.key.length > 0), true);

// ---------------------------------------------------------------------------
// 5. Rounding — the same helper decides every money figure on both sides
// ---------------------------------------------------------------------------

console.log('\n--- rounding ---');
check('near-tie rounds up', round(1.005), 1.01);
check('negatives round symmetrically', round(-1.005), -1.01);
check('a negative is the mirror of its positive', round(-2.675), -round(2.675));
check('plain values are untouched', [round(0), round(12.34), round(-12.34)], [0, 12.34, -12.34]);
check('three decimals work too', round(1.0005, 3), 1.001);
check('infinities pass through', [round(Infinity), round(-Infinity)], [Infinity, -Infinity]);
// The client mirrors this exactly; suggestCostDim must agree with the server.
check('cost-dim suggestion matches the server rule', suggestCostDim(25, 20), round(25 * 1.2, 3));
check('a thousand small amounts still add up', round(Array.from({ length: 1000 }, () => 0.01).reduce((a, b) => round(a + b), 0)), 10);

// ---------------------------------------------------------------------------
// 6. Manforce — attendance, piece work, statutory dues, advances
//
// There are no pay periods: a worker is a running account. So what matters here is
// that earnings are DERIVED correctly from the calendar and the board, and that the
// two figures the UI shows — cash due now and the party balance — differ by exactly
// the advance still outstanding.
// ---------------------------------------------------------------------------

console.log('\n--- working-day calendar ---');
const rules: WorkforceRules = { ...DEFAULT_RULES };
// January 2026 starts on a Thursday, so the 4th, 11th, 18th and 25th are Sundays.
const holidays = new Set<string>(['2026-01-05']);
check('a Sunday is not a working day', isWorkingDay(new Date(2026, 0, 4), rules, holidays), false);
check('a holiday is not a working day', isWorkingDay(new Date(2026, 0, 5), rules, holidays), false);
check('an ordinary day is', isWorkingDay(new Date(2026, 0, 6), rules, holidays), true);
check('weekly offs parse from CSV', parseWeeklyOffDays('0, 6, 9, x'), [0, 6]);
// Attendance is a calendar fact, so a date must read as the LOCAL day. Formatting a
// local midnight with toISOString() names the day BEFORE anywhere east of UTC, which
// would silently shift a whole muster — and a statutory period — by one day.
check('a day key reads the local date, not the UTC one', dayKey(new Date(2026, 0, 5)), '2026-01-05');
check('and survives a round trip through midnight', dayKey(dayStart(new Date(2026, 0, 5, 23, 59))), '2026-01-05');
check('a month key does too', monthKey(new Date(2026, 0, 1)), '2026-01');
check('January 2026 has 27 working days before holidays', workingDaysInMonth('2026-01', DEFAULT_RULES, new Set()), 27);
check('a holiday removes one', workingDaysInMonth('2026-01', DEFAULT_RULES, holidays), 26);

console.log('\n--- day wages, exceptions only ---');
const dayWorker = { id: 1, payType: 'DAY', dailyRate: 500, otHourlyRate: 0, monthlySalary: 0, joinedOn: new Date(2025, 0, 1) };
const week = { from: new Date(2026, 0, 1), to: new Date(2026, 0, 7) };
const earned = (att: { date: Date; status: string; otHours?: number }[], hol = new Set<string>()) => round(attendanceEarnings(dayWorker, att, week.from, week.to, rules, hol).reduce((a, e) => a + e.amount, 0));
check('nobody marked = everyone presumed present', earned([]), 3000); // 6 working days x 500
check('an absence docks a day', earned([{ date: new Date(2026, 0, 2), status: 'ABSENT' }]), 2500);
check('a half day docks half', earned([{ date: new Date(2026, 0, 3), status: 'HALF_DAY' }]), 2750);
check('unpaid leave earns nothing, paid leave earns fully', earned([{ date: new Date(2026, 0, 2), status: 'LEAVE' }, { date: new Date(2026, 0, 3), status: 'PAID_LEAVE' }]), 2500);
check('a holiday is not paid', earned([], holidays), 2500);
check('working a holiday is paid', earned([{ date: new Date(2026, 0, 5), status: 'PRESENT' }], holidays), 3000);
check('working a Sunday is paid', earned([{ date: new Date(2026, 0, 4), status: 'PRESENT' }]), 3500);
check('an unmarked Sunday is not', earned([]), 3000);
check('overtime derives its rate from the day', earned([{ date: new Date(2026, 0, 6), status: 'PRESENT', otHours: 3 }]), 3375); // (500/8)*2 = 125/h
check('nothing accrues before joining', round(attendanceEarnings({ ...dayWorker, joinedOn: new Date(2026, 0, 6) }, [], week.from, week.to, rules, new Set()).reduce((a, e) => a + e.amount, 0)), 1000);
check('nothing accrues after leaving', round(attendanceEarnings({ ...dayWorker, exitOn: new Date(2026, 0, 2) }, [], week.from, week.to, rules, new Set()).reduce((a, e) => a + e.amount, 0)), 1000);
// A worker migrated from typed wage entries must not have days invented for the
// period those entries already covered.
check('nothing accrues before the accrual start', round(attendanceEarnings({ ...dayWorker, accrualFrom: new Date(2026, 0, 6) }, [], week.from, week.to, rules, new Set()).reduce((a, e) => a + e.amount, 0)), 1000);
check('an accrual start before joining cannot widen the window', accrualStart({ ...dayWorker, joinedOn: new Date(2026, 0, 6), accrualFrom: new Date(2025, 0, 1) }).getTime(), new Date(2026, 0, 6).getTime());
check('a piece-rate worker earns nothing from attendance', attendanceEarnings({ ...dayWorker, payType: 'PIECE' }, [{ date: new Date(2026, 0, 2), status: 'PRESENT' }], week.from, week.to, rules, new Set()), []);
check('presuming nothing pays only what is marked', round(attendanceEarnings(dayWorker, [{ date: new Date(2026, 0, 2), status: 'PRESENT' }], week.from, week.to, { ...rules, presumePresent: false }, new Set()).reduce((a, e) => a + e.amount, 0)), 500);

console.log('\n--- monthly salary, pro-rata ---');
const salaried = { id: 2, payType: 'MONTHLY', dailyRate: 0, otHourlyRate: 0, monthlySalary: 27000, joinedOn: new Date(2025, 0, 1) };
const janAll = attendanceEarnings(salaried, [], new Date(2026, 0, 1), new Date(2026, 0, 31), rules, new Set());
check('a full month accrues the salary', round(janAll.reduce((a, e) => a + e.amount, 0)), 27000); // 27 working days x ₹1000
check('it accrues day by day, not as a lump', janAll.length, 27);
check('mid-month it is already worth something', round(attendanceEarnings(salaried, [], new Date(2026, 0, 1), new Date(2026, 0, 15), rules, new Set()).reduce((a, e) => a + e.amount, 0)), 13000);
check('an absence docks exactly one working day', round(attendanceEarnings(salaried, [{ date: new Date(2026, 0, 6), status: 'ABSENT' }], new Date(2026, 0, 1), new Date(2026, 0, 31), rules, new Set()).reduce((a, e) => a + e.amount, 0)), 26000);
check('a 26-day basis divides by 26', round(monthlyPerDay(26000, '2026-01', { ...rules, monthlyDivisor: 'FIXED_26' }, new Set())), 1000);

console.log('\n--- in-house piece work off the board ---');
const inHouse: StageRow[] = ['Joining', 'Polishing', 'Packing'].map((name, i) => ({ id: i + 1, name, sortOrder: i, vendorId: null, jobworkRate: 0, labourRate: i === 1 ? 40 : 0 }) as StageRow);
const withWorkers = (id: number, kind: string, from: number | null, to: number | null, qty: number, day: number, workers?: { workerId: number; pieces: number }[]) => ({ ...mv(id, kind, from, to, qty, day), workers });
const labourLine = {
  id: 1,
  product: { factoryCode: 'AB-1', name: 'Test' },
  stages: inHouse as never,
  moves: [
    withWorkers(1, 'RELEASE', null, 1, 10, 1),
    withWorkers(2, 'ADVANCE', 1, 2, 10, 2),
    withWorkers(3, 'ADVANCE', 2, 3, 6, 3, [{ workerId: 7, pieces: 4 }, { workerId: 8, pieces: 2 }]),
    withWorkers(4, 'REJECT', 3, 2, 2, 4),
    withWorkers(5, 'ADVANCE', 2, 3, 2, 5, [{ workerId: 7, pieces: 2 }]),
  ] as never,
};
const pieceEvents = labourEvents({ id: 1, number: 'ORD-1' }, labourLine as never);
check('one earning per named worker per clearance', pieceEvents.length, 3);
check('each worker earns their own pieces x the stage rate', pieceEvents.map((e) => [e.workerId, e.amount]), [[7, 160], [8, 80], [7, 80]]);
check('re-done work earns again, and says so', pieceEvents[2].label, 'Polishing — 2 pc (re-done)');
check('piece earnings reconcile with the board', round(pieceEvents.reduce((a, e) => a + e.amount, 0)), round(buildBoard(10, inHouse, labourLine.moves as never).stages[1].cleared * 40));
check('a clearance with nobody named pays nobody', labourEvents({ id: 1, number: 'ORD-1' }, { ...labourLine, moves: [withWorkers(2, 'ADVANCE', 1, 2, 10, 2)] } as never), []);

console.log('\n--- naming workers on a movement ---');
const polishing = { vendorId: null, labourRate: 40, name: 'Polishing' };
check('pieces must add up to the movement', validateMoveWorkers(10, [{ workerId: 7, pieces: 4 }, { workerId: 8, pieces: 2 }], polishing), 'The pieces per worker add up to 6, but 10 pc are being moved.');
check('an exact split passes', validateMoveWorkers(6, [{ workerId: 7, pieces: 4 }, { workerId: 8, pieces: 2 }], polishing), null);
check('naming nobody is always allowed', validateMoveWorkers(6, [], polishing), null);
check('the same worker cannot be listed twice', validateMoveWorkers(6, [{ workerId: 7, pieces: 4 }, { workerId: 7, pieces: 2 }], polishing), 'The same worker is listed twice — combine their pieces into one line.');
check('an outsourced stage pays its vendor, not workers', validateMoveWorkers(6, [{ workerId: 7, pieces: 6 }], { vendorId: 99, labourRate: 0, name: 'Polishing' }), 'Polishing is outsourced — the vendor is paid for it, so workers cannot be named on it.');
check('a stage with no rate cannot pay the workers named on it', validateMoveWorkers(6, [{ workerId: 7, pieces: 6 }], { ...polishing, labourRate: 0 }), 'Polishing has no piece rate, so there is nothing to pay the workers named on it. Set a labour rate on the stage first.');

console.log('\n--- statutory components ---');
const pf = { id: 1, code: 'PF', name: 'Provident Fund', employeePct: 12, employerPct: 12, flatAmount: 0, basis: 'BASIC', wageCeiling: 15000, eligibilityCeiling: null, minWages: null };
const esi = { id: 2, code: 'ESI', name: 'ESI', employeePct: 0.75, employerPct: 3.25, flatAmount: 0, basis: 'GROSS', wageCeiling: null, eligibilityCeiling: 21000, minWages: null };
const pt = { id: 3, code: 'PT', name: 'Professional tax', employeePct: 0, employerPct: 0, flatAmount: 200, basis: 'GROSS', wageCeiling: null, eligibilityCeiling: null, minWages: 15000 };
check('PF caps the base at the ceiling and ignores overtime', [computeStatutory(pf, { gross: 20000, basic: 18000 }).employeeAmt, computeStatutory(pf, { gross: 20000, basic: 18000 }).employerAmt], [1800, 1800]);
check('below the ceiling PF uses the actual wage', computeStatutory(pf, { gross: 12000, basic: 12000 }).employeeAmt, 1440);
check('ESI splits employee and employer', [computeStatutory(esi, { gross: 20000, basic: 20000 }).employeeAmt, computeStatutory(esi, { gross: 20000, basic: 20000 }).employerAmt], [150, 650]);
check('above its eligibility ceiling ESI does not apply', computeStatutory(esi, { gross: 22000, basic: 22000 }).covered, false);
check('a flat component is a flat amount', computeStatutory(pt, { gross: 16000, basic: 16000 }).employeeAmt, 200);
check('below its threshold it does not apply', computeStatutory(pt, { gross: 14000, basic: 14000 }).employeeAmt, 0);
check('no wages, nothing due', computeStatutory(pf, { gross: 0, basic: 0 }).covered, false);
const otWeek = attendanceEarnings(dayWorker, [{ date: new Date(2026, 0, 6), status: 'PRESENT', otHours: 3 }], week.from, week.to, rules, new Set());
check('the BASIC base excludes overtime', wageBase(otWeek), { gross: 3375, basic: 3000 });

console.log('\n--- advances, recovered from earnings ---');
const evt = (day: number, amount: number): EarningEvent => ({ key: `e${day}-${amount}`, workerId: 1, date: new Date(2026, day < 32 ? 0 : 1, day < 32 ? day : day - 31), kind: 'DAY', label: 'Present', days: 1, hours: 0, pieces: 0, rate: amount, amount, overtime: false });
const janFeb = [evt(10, 3000), evt(40, 3000)]; // ₹3,000 in January, ₹3,000 in February
const capped = workerPosition({ workerId: 1, earnings: janFeb, deductions: [], statutory: [], advances: [{ id: 1, date: new Date(2026, 0, 5), amount: 10000, recoveryPerMonth: 1000 }], payments: [] });
check('a capped advance recovers only its cap each month', capped.advanceRecovered, 2000);
check('the rest stays outstanding', capped.advanceOutstanding, 8000);
check('cash is still due despite the advance', capped.dueNow, 4000);
check('the party balance shows the worker in debt', capped.balance, -4000);
check('due now less the advance outstanding IS the balance', round(capped.dueNow - capped.advanceOutstanding), capped.balance);

const uncapped = workerPosition({ workerId: 1, earnings: [evt(10, 2000)], deductions: [], statutory: [], advances: [{ id: 1, date: new Date(2026, 0, 5), amount: 5000, recoveryPerMonth: 0 }], payments: [] });
check('an uncapped advance is just a payment that outran the earnings', [uncapped.advanceRecovered, uncapped.advanceOutstanding, uncapped.dueNow, uncapped.balance], [2000, 3000, 0, -3000]);
check('and the identity still holds', round(uncapped.dueNow - uncapped.advanceOutstanding), uncapped.balance);

const backdated = recoverAdvances([{ id: 1, date: new Date(2026, 1, 1), amount: 5000, recoveryPerMonth: 0 }], [evt(10, 3000)]);
check('earnings from before an advance cannot recover it', backdated.advances[0].outstanding, 5000);

const settled = workerPosition({
  workerId: 1,
  earnings: janFeb,
  deductions: [{ id: 1, date: new Date(2026, 0, 20), amount: 300, label: 'Canteen' }],
  statutory: [{ id: 1, date: new Date(2026, 0, 31), amount: 360, label: 'PF' }],
  advances: [],
  payments: [{ id: 1, date: new Date(2026, 1, 10), amount: 2000, label: 'Wages' }],
});
check('deductions and statutory reduce what is owed', settled.dueNow, 3340); // 6000 - 300 - 360 - 2000
check('with no advance, due now and the balance agree', [settled.dueNow, settled.balance], [3340, 3340]);
check('an empty account is zero everywhere', workerPosition({ workerId: 1, earnings: [], deductions: [], statutory: [], advances: [], payments: [] }).balance, 0);

// ---------------------------------------------------------------------------
// 7. Suggestions — "what did we use last time"
//
// Derived from live records, so what matters here is the maths that decides which
// figure leads and whether a typed one looks wrong. The client mirrors `outlier()`
// so the note can update as you type; both must agree.
// ---------------------------------------------------------------------------

console.log('\n--- matching the same item across products ---');
check('case and spacing are noise', [normalizeKey('CARVING LABOUR'), normalizeKey('Carving  Labour'), normalizeKey('  carving labour ')], ['carving labour', 'carving labour', 'carving labour']);
check('different wording stays different', normalizeKey('CARVING LABOR') === normalizeKey('CARVING LABOUR'), false);
check('nothing normalises to nothing', normalizeKey(null), '');

console.log('\n--- summarising past uses ---');
const occ = (value: number, day: number, label = 'AB-1'): Occurrence => ({ value, date: new Date(2026, 0, day), label });
const stats = summarize('COSTED', 'Costed before', [occ(240, 5), occ(280, 20), occ(260, 12)]);
check('the newest use leads', stats.last!.value, 280);
check('the range is the range', [stats.min, stats.max], [240, 280]);
check('the average is the average', stats.avg, 260);
check('a zero or negative figure is not a use', summarize('X', 'x', [occ(0, 1), occ(-5, 2), occ(100, 3)]).count, 1);
check('no history means no suggestion', summarize('X', 'x', []).last, null);

console.log('\n--- out of line ---');
check('a fat-fingered figure is flagged', outlier(2600, stats, 25).flag, 'HIGH');
check('and says how far off it is', Math.round(outlier(2600, stats, 25).pct), 900);
check('an unusually low one too', outlier(100, stats, 25).flag, 'LOW');
check('a sensible figure is not', outlier(270, stats, 25).flag, null);
check('the threshold is respected', [outlier(330, stats, 25).flag, outlier(330, stats, 30).flag], ['HIGH', null]);
// One previous use is not a pattern; warning on it would cry wolf on every new item.
check('a single past use never warns', outlier(9999, summarize('X', 'x', [occ(100, 1)]), 25).flag, null);
check('an empty field never warns', outlier(null, stats, 25).flag, null);
check('the reference is the average, not the last', outlier(2600, stats, 25).reference, 260);

console.log('\n--- which source leads ---');
const costedSrc = summarize('COSTED', 'Costed before', [occ(260, 10)]);
const purchasedSrc = summarize('PURCHASED', 'A supplier billed', [occ(612, 12)]);
const emptySrc = summarize('JOBWORK', 'Vendors charged', []);
check('the most comparable source with history leads', assemble('k', 'CARVING LABOUR', [costedSrc, purchasedSrc]).primary!.kind, 'COSTED');
check('an empty source is dropped, not shown blank', assemble('k', 'x', [emptySrc, purchasedSrc]).sources.map((s) => s.kind), ['PURCHASED']);
check('sources are kept separate, never averaged', assemble('k', 'x', [costedSrc, purchasedSrc]).sources.map((s) => s.last!.value), [260, 612]);
check('nothing anywhere means nothing to suggest', assemble('k', 'x', [emptySrc]).primary, null);

console.log('\n--- the window ---');
check('a window is a cut-off date in the past', windowStart(365)! < new Date(), true);
check('365 days back is 365 days back', Math.round((Date.now() - windowStart(365)!.getTime()) / 86400000), 365);
check('zero days means no limit', windowStart(0), null);

console.log(failed === 0 ? '\nALL SELF-CHECKS PASSED' : `\n${failed} SELF-CHECK(S) FAILED`);
if (failed) process.exitCode = 1;
