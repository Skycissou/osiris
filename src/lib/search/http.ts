// ─────────────────────────────────────────────────────────────────────────
//  Client HTTP amont — PORTAGE de open_radar/http.py (get_json) :
//   · UA identifié · timeout · cache (Map+TTL) · 1 retry sur transitoire (5xx /
//     réseau), JAMAIS sur 4xx (requête mauvaise, réessayer ne change rien).
//  + circuit-breaker par connecteur (pattern V4.078) posé À CE NIVEAU pour
//    couper une source morte. Appels SERVEUR uniquement (route handlers).
// ─────────────────────────────────────────────────────────────────────────

import { cacheGet, cacheSet } from './cache';
import { breakerOpen, breakerSuccess, breakerFailure } from './breaker';

// UA identifié (déontologie API publiques) — repris de http.py, tag V4.
export const USER_AGENT = 'OsirisV4-FR/1.0 (+defensive public-data exploration; cyril.detout@gmail.com)';

const TIMEOUT_MS = Number(process.env.OSIRIS_SEARCH_TIMEOUT ?? 10_000);

/** Construit une URL avec query string (ignore les valeurs vides/nulles). */
export function buildUrl(base: string, params: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export class UpstreamError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
  }
}

async function fetchOnce(url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new UpstreamError(`HTTP ${res.status} ${res.statusText}`, res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET JSON avec cache + 1 retry transitoire + circuit-breaker.
 * @param breakerName clé du connecteur pour le circuit-breaker (ex. 'entreprises').
 */
export async function getJson<T = unknown>(
  url: string,
  breakerName: string,
  opts: { useCache?: boolean; retries?: number } = {},
): Promise<T> {
  const { useCache = true, retries = 1 } = opts;

  if (useCache) {
    const cached = cacheGet<T>(url);
    if (cached !== null) return cached;
  }
  if (breakerOpen(breakerName)) {
    throw new UpstreamError(`Circuit ouvert (${breakerName}) : source récemment en échec, appel suspendu.`);
  }

  let attempt = 0;
  for (;;) {
    try {
      const data = await fetchOnce(url);
      breakerSuccess(breakerName);
      if (useCache) cacheSet(url, data);
      return data as T;
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : undefined;
      // 4xx = requête mauvaise → pas de retry (fidèle à http.py).
      const transient = status === undefined || status >= 500;
      if (!transient || attempt >= retries) {
        breakerFailure(breakerName);
        throw err;
      }
      attempt += 1;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}
