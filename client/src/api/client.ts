import axios from 'axios';

export const TOKEN_KEY = 'saraswati_erp_token';

// `withCredentials` lets the httpOnly session cookie ride along; it is what allows
// <img src="/uploads/…"> to load files that are no longer served publicly.
export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401 && onUnauthorized) onUnauthorized();
    return Promise.reject(err);
  }
);

// Turn a server field path like "costSheet.groups.0.lines.2.name" into
// something readable: "Costing Sheet › Group 1 › Line 3 › Item name".
const FIELD_LABELS: Record<string, string> = {
  factoryCode: 'Factory Code',
  name: 'Name',
  rate: 'Rate',
  qty: 'Qty',
  buyerId: 'Buyer',
  relatedId: 'Related product',
  groups: 'Group',
  lines: 'Line',
  costSheet: 'Costing Sheet',
  buyers: 'Buyer',
  related: 'Related',
};
function prettyPath(path: string): string {
  return path
    .split('.')
    .map((seg, i, arr) => {
      if (/^\d+$/.test(seg)) return `#${Number(seg) + 1}`;
      const label = FIELD_LABELS[seg] ?? seg;
      // attach index to the preceding label (Group #1)
      const next = arr[i + 1];
      return /^\d+$/.test(next ?? '') ? `${label} ` : label;
    })
    .join(' › ')
    .replace(/ › #/g, ' #');
}

/** Extract a human-readable message from an axios error. */
export function apiError(err: unknown, fallback = 'Something went wrong.'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; details?: { path?: string; message?: string }[] } | undefined;
    if (data?.error) {
      if (data.details?.length) {
        const parts = data.details.map((d) => (d.path ? `${prettyPath(d.path)}: ${d.message}` : d.message));
        return `${data.error} — ${parts.join('; ')}`;
      }
      return data.error;
    }
    return err.message;
  }
  return fallback;
}
