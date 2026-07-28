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

console.log(failed === 0 ? '\nALL SELF-CHECKS PASSED' : `\n${failed} SELF-CHECK(S) FAILED`);
if (failed) process.exitCode = 1;
