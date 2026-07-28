export function money(value: number | null | undefined, symbol = '₹', dp = 2): string {
  if (value == null || isNaN(value)) return '—';
  return `${symbol}${value.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function num(value: number | null | undefined, dp = 2): string {
  if (value == null || isNaN(value)) return '—';
  return value.toLocaleString('en-IN', { maximumFractionDigits: dp });
}

/** Absolute date-time plus a short relative hint, e.g. "28 Jul 2026, 6:14 pm (3 days ago)". */
export function formatUpdated(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const abs = d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  let rel: string;
  if (days <= 0) rel = 'today';
  else if (days === 1) rel = 'yesterday';
  else if (days < 30) rel = `${days} days ago`;
  else if (days < 365) rel = `${Math.floor(days / 30)} month(s) ago`;
  else rel = `${Math.floor(days / 365)} year(s) ago`;
  return `${abs} (${rel})`;
}

const STATUS_COLORS: Record<string, string> = {
  Active: 'green',
  Draft: 'gold',
  Discontinued: 'red',
};
export const statusColor = (s: string) => STATUS_COLORS[s] ?? 'default';

const HEAD_COLORS: Record<string, string> = {
  MAIN_COMPONENT: '#6d4c41',
  SUB_COMPONENT: '#8d6e63',
  HARDWARE: '#5d4037',
  POLISHING: '#a1887f',
  PACKAGING: '#795548',
  LABOUR: '#4e342e',
  FORWARDING: '#3e2723',
};
export const headColor = (h: string) => HEAD_COLORS[h] ?? '#6d4c41';
