import { lineAmount, lineMeasure, rollup, round, type MethodMap, type Rollup } from './costing';

interface DbLine {
  qty: number;
  wastagePct: number;
  actualL: number | null;
  actualW: number | null;
  actualH: number | null;
  costL: number | null;
  costW: number | null;
  costH: number | null;
  actualWeight: number | null;
  rate: number;
  [k: string]: unknown;
}
interface DbGroup {
  head: string;
  method: string;
  lines: DbLine[];
  [k: string]: unknown;
}
interface DbSheet {
  factoryExpensePct: number;
  marginPct: number;
  groups: DbGroup[];
  [k: string]: unknown;
}

function roundRollup(r: Rollup) {
  const headTotals: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.headTotals)) headTotals[k] = round(v);
  return {
    headTotals,
    exFactory: round(r.exFactory),
    forwarding: round(r.forwarding),
    factoryExpense: round(r.factoryExpense),
    margin: round(r.margin),
    fob: round(r.fob),
    nonFobFactoryExpense: round(r.nonFobFactoryExpense),
    nonFobMargin: round(r.nonFobMargin),
    nonFob: round(r.nonFob),
    factoryExpensePct: r.factoryExpensePct,
    marginPct: r.marginPct,
  };
}

/**
 * Enrich a cost sheet with computed measures/amounts on each line, group
 * totals, and the full roll-up (ex-factory → FOB / Non-FOB).
 */
export function computeCostSheet(sheet: DbSheet | null | undefined, methods: MethodMap) {
  if (!sheet) return null;

  const groups = (sheet.groups || []).map((g) => {
    const def = methods[g.method];
    const lines = (g.lines || []).map((ln) => ({
      ...ln,
      measure: round(lineMeasure(def, ln), 4),
      amount: round(lineAmount(def, ln)),
    }));
    const total = round((g.lines || []).reduce((s, ln) => s + lineAmount(def, ln), 0));
    return { ...g, lines, total };
  });

  const summary = roundRollup(
    rollup(
      {
        groups: (sheet.groups || []).map((g) => ({ head: g.head, method: g.method, lines: g.lines })),
        factoryExpensePct: sheet.factoryExpensePct,
        marginPct: sheet.marginPct,
      },
      methods
    )
  );

  return { ...sheet, groups, summary };
}
