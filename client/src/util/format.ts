export function money(value: number | null | undefined, symbol = '₹', dp = 2): string {
  if (value == null || isNaN(value)) return '—';
  return `${symbol}${value.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function num(value: number | null | undefined, dp = 2): string {
  if (value == null || isNaN(value)) return '—';
  return value.toLocaleString('en-IN', { maximumFractionDigits: dp });
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
