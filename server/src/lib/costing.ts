// ---------------------------------------------------------------------------
// Costing engine — pure functions. Measurement methods are now DATA-DRIVEN:
// each method carries a free-form formula (see expr.ts) evaluated against the
// line's variables. Verified against example.xlsx (CRAZY ALMIRAH, FOB 19180.60).
// ---------------------------------------------------------------------------
import { tryEvalExpr } from './expr';

export const COST_HEADS = [
  'MAIN_COMPONENT',
  'SUB_COMPONENT',
  'HARDWARE',
  'POLISHING',
  'PACKAGING',
  'LABOUR',
  'FORWARDING',
] as const;
export type CostHead = (typeof COST_HEADS)[number];

export const HEAD_META: Record<CostHead, { label: string; order: number }> = {
  MAIN_COMPONENT: { label: 'Main Component', order: 1 },
  SUB_COMPONENT: { label: 'Sub Component', order: 2 },
  HARDWARE: { label: 'Hardware', order: 3 },
  POLISHING: { label: 'Polishing', order: 4 },
  PACKAGING: { label: 'Packaging', order: 5 },
  LABOUR: { label: 'Labour', order: 6 },
  FORWARDING: { label: 'Forwarding', order: 7 },
};

/** FORWARDING is excluded from Ex-Factory cost. */
export const EX_FACTORY_HEADS: CostHead[] = COST_HEADS.filter((h) => h !== 'FORWARDING');

/** Variables a formula may reference. */
export const ALLOWED_VARS = ['L', 'W', 'H', 'AL', 'AW', 'AH', 'QTY', 'WASTAGE', 'WEIGHT'];

export interface MethodDef {
  code: string;
  label: string;
  measureUnit: string;
  expression: string;
  usesL: boolean;
  usesW: boolean;
  usesH: boolean;
  usesWeight: boolean;
  usesWastage: boolean;
  dimUnit?: string | null;
}

export type MethodMap = Record<string, MethodDef>;

/** Seed data for the six built-in methods (formulas verified against example.xlsx). */
export const BUILTIN_METHODS: (MethodDef & { sortOrder: number })[] = [
  { code: 'CFT', label: 'Cubic Feet (volume)', measureUnit: 'CFT', expression: 'L*W*H/1728*QTY', usesL: true, usesW: true, usesH: true, usesWeight: false, usesWastage: true, dimUnit: 'IN', sortOrder: 0 },
  { code: 'SQFT', label: 'Square Feet (area)', measureUnit: 'SQFT', expression: 'L*W/144*QTY', usesL: true, usesW: true, usesH: false, usesWeight: false, usesWastage: true, dimUnit: 'IN', sortOrder: 1 },
  { code: 'SQMT', label: 'Square Metre (area)', measureUnit: 'SQM', expression: 'L*W/10000*QTY', usesL: true, usesW: true, usesH: false, usesWeight: false, usesWastage: true, dimUnit: 'CM', sortOrder: 2 },
  { code: 'RFT', label: 'Running Feet (length)', measureUnit: 'RFT', expression: 'L/12*QTY', usesL: true, usesW: false, usesH: false, usesWeight: false, usesWastage: true, dimUnit: 'IN', sortOrder: 3 },
  { code: 'WEIGHT', label: 'Weight (kg)', measureUnit: 'KGS', expression: 'WEIGHT*(1+WASTAGE/100)*QTY', usesL: false, usesW: false, usesH: false, usesWeight: true, usesWastage: true, dimUnit: null, sortOrder: 4 },
  { code: 'QTY', label: 'Quantity (per unit)', measureUnit: 'UNIT', expression: 'QTY', usesL: false, usesW: false, usesH: false, usesWeight: false, usesWastage: false, dimUnit: null, sortOrder: 5 },
];

/** The dimension letters a method uses, for UI column rendering. */
export function methodDims(m: MethodDef): ('L' | 'W' | 'H')[] {
  const d: ('L' | 'W' | 'H')[] = [];
  if (m.usesL) d.push('L');
  if (m.usesW) d.push('W');
  if (m.usesH) d.push('H');
  return d;
}

export interface LineInput {
  qty?: number | null;
  wastagePct?: number | null;
  actualL?: number | null;
  actualW?: number | null;
  actualH?: number | null;
  costL?: number | null;
  costW?: number | null;
  costH?: number | null;
  actualWeight?: number | null;
  rate?: number | null;
}

const n = (v: number | null | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0);

export function lineVars(line: LineInput): Record<string, number> {
  return {
    L: n(line.costL),
    W: n(line.costW),
    H: n(line.costH),
    AL: n(line.actualL),
    AW: n(line.actualW),
    AH: n(line.actualH),
    QTY: line.qty == null ? 1 : n(line.qty),
    WASTAGE: n(line.wastagePct),
    WEIGHT: n(line.actualWeight),
  };
}

export function lineMeasure(method: MethodDef | undefined, line: LineInput): number {
  if (!method) return line.qty == null ? 1 : n(line.qty);
  return tryEvalExpr(method.expression, lineVars(line));
}

export function lineAmount(method: MethodDef | undefined, line: LineInput): number {
  return lineMeasure(method, line) * n(line.rate);
}

/** Suggest a costing dimension from an actual dimension + wastage%. */
export function suggestCostDim(actual: number | null | undefined, wastagePct: number | null | undefined): number {
  return round(n(actual) * (1 + n(wastagePct) / 100), 3);
}

export interface GroupInput {
  head: string;
  method: string;
  lines: LineInput[];
}

export function groupTotal(group: GroupInput, methods: MethodMap): number {
  const m = methods[group.method];
  return group.lines.reduce((sum, ln) => sum + lineAmount(m, ln), 0);
}

export interface RollupInput {
  groups: GroupInput[];
  factoryExpensePct?: number | null;
  marginPct?: number | null;
}

export interface Rollup {
  headTotals: Record<string, number>;
  exFactory: number;
  forwarding: number;
  factoryExpense: number;
  margin: number;
  fob: number;
  nonFobFactoryExpense: number;
  nonFobMargin: number;
  nonFob: number;
  factoryExpensePct: number;
  marginPct: number;
}

export function rollup(input: RollupInput, methods: MethodMap): Rollup {
  const factoryExpensePct = input.factoryExpensePct == null ? 15 : n(input.factoryExpensePct);
  const marginPct = input.marginPct == null ? 15 : n(input.marginPct);

  const headTotals: Record<string, number> = {};
  for (const head of COST_HEADS) headTotals[head] = 0;
  for (const g of input.groups) {
    if (!(g.head in headTotals)) headTotals[g.head] = 0;
    headTotals[g.head] += groupTotal(g, methods);
  }

  const exFactory = EX_FACTORY_HEADS.reduce((s, h) => s + (headTotals[h] || 0), 0);
  const forwarding = headTotals['FORWARDING'] || 0;

  const factoryExpense = (exFactory + forwarding) * (factoryExpensePct / 100);
  const margin = (exFactory + forwarding + factoryExpense) * (marginPct / 100);
  const fob = exFactory + forwarding + factoryExpense + margin;

  const nonFobFactoryExpense = exFactory * (factoryExpensePct / 100);
  const nonFobMargin = (exFactory + nonFobFactoryExpense) * (marginPct / 100);
  const nonFob = exFactory + nonFobFactoryExpense + nonFobMargin;

  return {
    headTotals,
    exFactory,
    forwarding,
    factoryExpense,
    margin,
    fob,
    nonFobFactoryExpense,
    nonFobMargin,
    nonFob,
    factoryExpensePct,
    marginPct,
  };
}

/**
 * Round half away from zero, nudging by an epsilon so values that binary floating
 * point stores just under a tie (1.005 as 1.00499…) still round up.
 *
 * The nudge is applied to the magnitude, not the signed value: adding it to a
 * negative number pushes it the wrong way, which made round(-1.005) give -1.00 while
 * round(1.005) gave 1.01. Negative amounts are real here — a credit balance, an
 * over-payment, a statement that has gone into credit.
 */
export function round(value: number, dp = 2): number {
  if (!isFinite(value)) return value;
  const f = Math.pow(10, dp);
  const r = Math.round((Math.abs(value) + Number.EPSILON) * f) / f;
  return value < 0 ? -r : r;
}
