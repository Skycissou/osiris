// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 LEAN — client API vers le backend FastAPI FR (EXTERNE).
//  Ce repo ne contient AUCUNE route de données FR : tout part en appel
//  sortant vers `NEXT_PUBLIC_API_BASE`. Le backend gère un login à COOKIE,
//  donc toutes les requêtes passent `credentials: 'include'`.
//  S'inspire du `fetchEndpoint` de l'ancien front (cache no-store).
// ─────────────────────────────────────────────────────────────────────────

/** Base URL du backend FastAPI FR (ex: https://api.osiris.cissouhub.cloud). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export interface ApiOptions extends RequestInit {
  /** Paramètres de query string ajoutés à l'URL. */
  params?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, params?: ApiOptions['params']): string {
  const base = API_BASE.replace(/\/$/, '');
  const url = /^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  const q = qs.toString();
  return q ? `${url}${url.includes('?') ? '&' : '?'}${q}` : url;
}

/**
 * Fetch centralisé vers le backend FR.
 * - `credentials: 'include'` TOUJOURS (login à cookie).
 * - `cache: 'no-store'` par défaut (données temps réel), surchargeable.
 * - Lève sur statut non-OK pour que l'appelant gère l'erreur.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { params, headers, ...rest } = options;
  const res = await fetch(buildUrl(path, params), {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...headers },
    ...rest,
  });
  if (!res.ok) {
    throw new Error(`[OSIRIS API] ${res.status} ${res.statusText} — ${path}`);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (await res.text())) as T;
}

/** Raccourci GET JSON — renvoie `null` en cas d'échec (fetch silencieux). */
export async function apiGet<T = unknown>(path: string, params?: ApiOptions['params']): Promise<T | null> {
  try {
    return await apiFetch<T>(path, { method: 'GET', params });
  } catch (e) {
    console.warn('[OSIRIS] apiGet failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Ping du backend (à câbler sur l'endpoint /health du FastAPI FR). */
export async function apiHealth(): Promise<boolean> {
  const r = await apiGet<{ status?: string }>('/health');
  return !!r;
}
