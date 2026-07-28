/**
 * The change log for figures that matter.
 *
 * Suggestions are derived from live records, so they answer "what did we use". They
 * cannot answer "what was this before someone changed it", because an edit destroys the
 * old value — that is what this exists for. Only money and rates are logged: a log of
 * every keystroke would bury the one entry anybody ever needs.
 *
 * `rootType`/`rootId` is the record a person would open to look for the answer. A cost
 * line's own id is useless for this, because saving a product REPLACES its whole cost
 * sheet — so a rate change is logged against the product.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient | PrismaClient;

export const CHANGE_ROOTS = ['Product', 'Order', 'Proforma', 'Worker', 'StatutoryComponent', 'Contractor', 'RawItem'] as const;
export type ChangeRoot = (typeof CHANGE_ROOTS)[number];

export interface Actor {
  id?: number | null;
  name?: string | null;
}

export interface FieldChange {
  entity: string;
  entityId?: number | null;
  field: string;
  /** What a person would call it, e.g. `CARVING LABOUR — rate`. */
  label: string;
  oldValue: unknown;
  newValue: unknown;
  note?: string | null;
}

/** Money and rates print to 2 dp; anything else keeps its own text. */
function asText(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** True when the two values differ in a way worth recording. */
function differs(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a ?? 0);
    const y = Number(b ?? 0);
    // Float money: ignore differences below a paisa, which are rounding, not edits.
    return Math.abs(x - y) > 0.005;
  }
  return asText(a) !== asText(b);
}

/**
 * Record the changes that actually happened. No-ops are dropped, so a save that
 * touched nothing leaves nothing behind.
 */
export async function logChanges(tx: Tx, root: { type: ChangeRoot; id: number }, actor: Actor, changes: FieldChange[]): Promise<number> {
  const real = changes.filter((c) => differs(c.oldValue, c.newValue));
  if (real.length === 0) return 0;
  await tx.changeLog.createMany({
    data: real.map((c) => ({
      entity: c.entity,
      entityId: c.entityId ?? null,
      rootType: root.type,
      rootId: root.id,
      field: c.field,
      label: c.label,
      oldValue: asText(c.oldValue),
      newValue: asText(c.newValue),
      note: c.note ?? null,
      userId: actor.id ?? null,
      userName: actor.name ?? '',
    })),
  });
  return real.length;
}

/** Compare two flat records over a set of fields, ready for `logChanges`. */
export function diffFields<T extends Record<string, unknown>>(
  entity: string,
  entityId: number | null | undefined,
  before: T | null | undefined,
  after: Partial<T>,
  fields: { field: keyof T & string; label: string }[],
  prefix = ''
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of fields) {
    if (!(f.field in after)) continue; // not part of this update at all
    out.push({
      entity,
      entityId: entityId ?? null,
      field: f.field,
      label: prefix ? `${prefix} — ${f.label}` : f.label,
      oldValue: before ? before[f.field] : null,
      newValue: after[f.field],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cost sheets
// ---------------------------------------------------------------------------

interface SheetLike {
  factoryExpensePct: number;
  marginPct: number;
  groups: { head: string; name: string; lines: { name: string; rate: number; qty: number; wastagePct: number; unit?: string | null }[] }[];
}

/**
 * Diff a product's costing before it is replaced.
 *
 * Product update deletes the sheet and writes a new one, so this has to run BEFORE the
 * write or the old rates are gone. Lines are matched on group + line name, which is the
 * same key suggestions use — a renamed line therefore reads as one removed and one
 * added, which is honest: nobody can tell those apart from the outside.
 */
export function diffCostSheet(before: SheetLike | null | undefined, after: SheetLike | null | undefined): FieldChange[] {
  const out: FieldChange[] = [];
  const key = (g: string, l: string) => `${g.trim().toLowerCase()}||${l.trim().toLowerCase()}`;

  const flatten = (s: SheetLike | null | undefined) => {
    const map = new Map<string, { group: string; head: string; line: { name: string; rate: number; qty: number; wastagePct: number } }>();
    for (const g of s?.groups ?? []) for (const l of g.lines) map.set(key(g.name, l.name), { group: g.name, head: g.head, line: l });
    return map;
  };

  const a = flatten(before);
  const b = flatten(after);

  if (before && after) {
    if (differs(before.factoryExpensePct, after.factoryExpensePct)) {
      out.push({ entity: 'CostSheet', field: 'factoryExpensePct', label: 'Factory expense %', oldValue: before.factoryExpensePct, newValue: after.factoryExpensePct });
    }
    if (differs(before.marginPct, after.marginPct)) {
      out.push({ entity: 'CostSheet', field: 'marginPct', label: 'Margin %', oldValue: before.marginPct, newValue: after.marginPct });
    }
  }

  for (const [k, next] of b) {
    const prev = a.get(k);
    const label = `${next.line.name} (${next.group})`;
    if (!prev) {
      if (next.line.rate > 0) out.push({ entity: 'CostLine', field: 'rate', label: `${label} — added`, oldValue: null, newValue: next.line.rate });
      continue;
    }
    for (const [field, name, was, now] of [
      ['rate', 'rate', prev.line.rate, next.line.rate],
      ['qty', 'qty', prev.line.qty, next.line.qty],
      ['wastagePct', 'wastage %', prev.line.wastagePct, next.line.wastagePct],
    ] as [string, string, number, number][]) {
      if (differs(was, now)) out.push({ entity: 'CostLine', field, label: `${label} — ${name}`, oldValue: was, newValue: now });
    }
  }

  for (const [k, prev] of a) {
    if (b.has(k)) continue;
    out.push({ entity: 'CostLine', field: 'rate', label: `${prev.line.name} (${prev.group}) — removed`, oldValue: prev.line.rate, newValue: null });
  }

  return out;
}
