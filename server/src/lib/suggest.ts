/**
 * "What did we use last time?"
 *
 * Every figure this offers is DERIVED from the records that already exist — cost
 * sheets, stock receipts, stage rates, orders and proformas. There is no price-memory
 * table, and deliberately so: a stored copy would drift the moment someone corrected
 * the original, and the correction is exactly the thing you want to see.
 *
 * Two questions are answered by two different mechanisms, and they should not be
 * confused:
 *
 *   "what did we use / pay / charge before"  -> derived, here
 *   "who changed this, and what was it"      -> ChangeLog, because an edit destroys
 *                                               the old value and nothing else can
 *                                               reconstruct it
 *
 * Sources are kept SEPARATE rather than averaged together. What a line was costed at
 * and what a supplier actually billed are different facts, and the gap between them is
 * the interesting part — merging them would hide it.
 */

/** Days of history a suggestion may draw on, and the tolerance for "out of line". */
export const DEFAULT_SUGGESTION_WINDOW_DAYS = 365;
export const DEFAULT_OUTLIER_PCT = 25;

/**
 * The key two figures are "the same thing" under.
 *
 * Case and spacing are noise — `CARVING LABOUR`, `Carving Labour` and
 * `carving  labour` are one item, because that is how the sheets were actually typed
 * over the years. Anything else (punctuation, wording) is left alone: guessing harder
 * than this would silently merge two genuinely different lines.
 */
export function normalizeKey(name: string | null | undefined): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** One past use of a figure, with enough context to recognise where it came from. */
export interface Occurrence {
  /** The figure itself — a rate, a price, a wage. */
  value: number;
  date: Date | string;
  /** Where it came from, e.g. `AB-00123 — Crazy Almirah`. */
  label: string;
  /** The detail under it, e.g. `Mango Wood · CFT · 20% wastage`. */
  detail?: string | null;
  unit?: string | null;
  qty?: number | null;
  /** Lets the client link straight to the record. */
  link?: { type: 'product' | 'order' | 'proforma' | 'stock' | 'worker'; id: number } | null;
}

export interface SourceStats {
  /** What this source IS, e.g. "costed before" or "supplier billed". */
  kind: string;
  label: string;
  count: number;
  /** The most recent use — the headline figure. */
  last: Occurrence | null;
  min: number;
  max: number;
  avg: number;
  /** Oldest first is useless here; the client shows newest first. */
  occurrences: Occurrence[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Roll a set of occurrences into a suggestion.
 *
 * The average is the reference the outlier check uses, not the last value: one odd
 * entry last week should not turn every sensible figure into a warning.
 */
export function summarize(kind: string, label: string, occurrences: Occurrence[], limit = 12): SourceStats {
  const sorted = [...occurrences]
    .filter((o) => Number.isFinite(o.value) && o.value > 0)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (sorted.length === 0) return { kind, label, count: 0, last: null, min: 0, max: 0, avg: 0, occurrences: [] };

  const values = sorted.map((o) => o.value);
  return {
    kind,
    label,
    count: sorted.length,
    last: sorted[0],
    min: r2(Math.min(...values)),
    max: r2(Math.max(...values)),
    avg: r2(values.reduce((a, v) => a + v, 0) / values.length),
    occurrences: sorted.slice(0, limit),
  };
}

export interface OutlierVerdict {
  flag: 'HIGH' | 'LOW' | null;
  /** How far off, as a percentage of the reference. */
  pct: number;
  reference: number;
  count: number;
}

/**
 * Is this figure out of line with what has been used before?
 *
 * Compared against the average of the window, and only once there is something to
 * compare with — a single previous use is not a pattern, so it never warns on it.
 * This never blocks anything; it is a note beside a field, meant to catch a ₹2,600
 * typed for ₹260 at the one moment it is cheap to fix.
 */
export function outlier(value: number | null | undefined, stats: SourceStats | null | undefined, pct = DEFAULT_OUTLIER_PCT): OutlierVerdict {
  const none: OutlierVerdict = { flag: null, pct: 0, reference: 0, count: stats?.count ?? 0 };
  if (!stats || stats.count < 2 || !value || value <= 0 || stats.avg <= 0) return none;
  const drift = ((value - stats.avg) / stats.avg) * 100;
  if (Math.abs(drift) < pct) return { ...none, pct: r2(drift), reference: stats.avg };
  return { flag: drift > 0 ? 'HIGH' : 'LOW', pct: r2(drift), reference: stats.avg, count: stats.count };
}

/** The cut-off date for a window, or null when history is unlimited. */
export function windowStart(days: number): Date | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(days));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Everything known about one figure, from every source that relates to it. */
export interface Suggestion {
  key: string;
  /** What the user typed, echoed back so the client can match responses to fields. */
  name: string;
  sources: SourceStats[];
  /** The source to lead with: the most directly comparable one that has any history. */
  primary: SourceStats | null;
}

/**
 * Assemble a suggestion, most-relevant source first.
 *
 * Order matters: the same line costed before is the direct answer, what a supplier
 * actually billed is the reality check behind it, and what was paid out for the stage
 * is the third view of the same money. Empty sources are dropped so the UI never shows
 * a heading with nothing under it.
 */
export function assemble(key: string, name: string, sources: (SourceStats | null | undefined)[]): Suggestion {
  const live = sources.filter((s): s is SourceStats => !!s && s.count > 0);
  return { key, name, sources: live, primary: live[0] ?? null };
}
