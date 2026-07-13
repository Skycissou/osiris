// ─────────────────────────────────────────────────────────────────────────
//  Cache mémoire process (Map + TTL) — sémantique de open_radar/cache.py, mais
//  EN MÉMOIRE (pas de fichiers) : l'app Next standalone est un process long,
//  un Map suffit et évite tout I/O disque. Clé = URL. TTL par défaut 900 s.
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = Number(process.env.OSIRIS_SEARCH_CACHE_TTL ?? 900) * 1000;
const MAX_ENTRIES = 500; // garde-fou mémoire (éviction FIFO grossière)

type Entry = { at: number; value: unknown };
const store = new Map<string, Entry>();

export function cacheGet<T = unknown>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() - e.at > ttlMs) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown): void {
  if (store.size >= MAX_ENTRIES) {
    // Évince la plus ancienne entrée (Map conserve l'ordre d'insertion).
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { at: Date.now(), value });
}
