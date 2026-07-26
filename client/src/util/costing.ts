// Client-side mirror of the server costing engine — now formula-driven.
// Used for live totals in the wizard. Formulas come from the method defs.
import { tryEvalExpr } from './expr';
import type { CostGroup, CostLine, CostSummary } from '../api/types';

export const COST_HEADS = ['MAIN_COMPONENT', 'SUB_COMPONENT', 'HARDWARE', 'POLISHING', 'PACKAGING', 'LABOUR', 'FORWARDING'] as const;
const EX_FACTORY_HEADS = COST_HEADS.filter((h) => h !== 'FORWARDING');

export interface MethodLike {
  code: string;
  expression: string;
  measureUnit?: string;
}
export type MethodMap = Record<string, MethodLike>;

const n = (v: number | null | undefined) => (typeof v === 'number' && isFinite(v) ? v : 0);

export function suggestCostDim(actual: number | null | undefined, wastagePct: number | null | undefined): number {
  return Math.round(n(actual) * (1 + n(wastagePct) / 100) * 1000) / 1000;
}

function lineVars(ln: CostLine): Record<string, number> {
  return {
    L: n(ln.costL),
    W: n(ln.costW),
    H: n(ln.costH),
    AL: n(ln.actualL),
    AW: n(ln.actualW),
    AH: n(ln.actualH),
    QTY: ln.qty == null ? 1 : n(ln.qty),
    WASTAGE: n(ln.wastagePct),
    WEIGHT: n(ln.actualWeight),
  };
}

export function lineMeasure(method: MethodLike | undefined, ln: CostLine): number {
  if (!method) return ln.qty == null ? 1 : n(ln.qty);
  return tryEvalExpr(method.expression, lineVars(ln));
}

export function lineAmount(method: MethodLike | undefined, ln: CostLine): number {
  return lineMeasure(method, ln) * n(ln.rate);
}

export function groupTotal(g: CostGroup, methods: MethodMap): number {
  const m = methods[g.method];
  return g.lines.reduce((s, ln) => s + lineAmount(m, ln), 0);
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export function rollup(groups: CostGroup[], methods: MethodMap, factoryExpensePct = 15, marginPct = 15): CostSummary {
  const headTotals: Record<string, number> = {};
  for (const h of COST_HEADS) headTotals[h] = 0;
  for (const g of groups) headTotals[g.head] = (headTotals[g.head] ?? 0) + groupTotal(g, methods);

  const exFactory = EX_FACTORY_HEADS.reduce((s, h) => s + (headTotals[h] || 0), 0);
  const forwarding = headTotals['FORWARDING'] || 0;

  const factoryExpense = (exFactory + forwarding) * (factoryExpensePct / 100);
  const margin = (exFactory + forwarding + factoryExpense) * (marginPct / 100);
  const fob = exFactory + forwarding + factoryExpense + margin;

  const nfFactoryExpense = exFactory * (factoryExpensePct / 100);
  const nfMargin = (exFactory + nfFactoryExpense) * (marginPct / 100);
  const nonFob = exFactory + nfFactoryExpense + nfMargin;

  const rounded: Record<string, number> = {};
  for (const [k, v] of Object.entries(headTotals)) rounded[k] = r2(v);

  return {
    headTotals: rounded,
    exFactory: r2(exFactory),
    forwarding: r2(forwarding),
    factoryExpense: r2(factoryExpense),
    margin: r2(margin),
    fob: r2(fob),
    nonFobFactoryExpense: r2(nfFactoryExpense),
    nonFobMargin: r2(nfMargin),
    nonFob: r2(nonFob),
    factoryExpensePct,
    marginPct,
  };
}
