// ─────────────────────────────────────────────────────────────────────────────
//  geocode.ts — Géocodage serveur d'une localité → { lat, lon }
//
//  Objectif (demande Cissou 09/07) : chaque alerte des autorités porte une
//  localité EN CLAIR (ville, CP, lieu). On l'identifie et on la pose sur la
//  carte, au lieu de la laisser « sans position ». Bénéficie à TOUTES les
//  sources (actuelles + futures Lot 3) sans que chaque parser n8n réinvente
//  le géocodage.
//
//  RGPD : on n'envoie au géocodeur QUE la localité (un lieu public), JAMAIS le
//  nom de la personne. Aucune donnée nominative ne sort.
//
//  Robustesse : cache persistant (les lieux ne bougent pas) + double fournisseur
//  BAN puis IGN Géoplateforme (les deux joignables depuis le VPS, prouvé par le
//  parser 116000 côté n8n). Timeout borné. Ne throw jamais → au pire lat/lon nuls.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface LatLon {
  lat: number;
  lon: number;
}

const TIMEOUT_MS = 5000;
const CONCURRENCY = 4;

function dir(): string {
  return process.env.OSIRIS_ALERTS_DIR || path.join(process.cwd(), 'data');
}
function cacheFile(): string {
  return path.join(dir(), 'geocache.json');
}

// Cache mémoire + persistance (protégé HMR/multi-instance). null = « déjà tenté,
// rien trouvé » → on ne re-géocode pas en boucle un lieu introuvable.
const G = globalThis as unknown as { __osirisGeocache?: Map<string, LatLon | null> | null };
if (G.__osirisGeocache === undefined) G.__osirisGeocache = null;

/** Normalise une localité pour la clé de cache (casse/espaces). */
function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

async function ensureCache(): Promise<Map<string, LatLon | null>> {
  if (G.__osirisGeocache) return G.__osirisGeocache;
  const map = new Map<string, LatLon | null>();
  try {
    const raw = await fs.readFile(cacheFile(), 'utf8').catch(() => '');
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, LatLon | null>;
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || (v && typeof v.lat === 'number' && typeof v.lon === 'number')) map.set(k, v);
      }
    }
  } catch {
    /* cache corrompu → repart vide */
  }
  G.__osirisGeocache = map;
  return map;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
async function persistSoon(map: Map<string, LatLon | null>): Promise<void> {
  // Débounce l'écriture disque : un lot de géocodages = une seule écriture.
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void (async () => {
      try {
        await fs.mkdir(dir(), { recursive: true });
        await fs.writeFile(cacheFile(), JSON.stringify(Object.fromEntries(map)), { encoding: 'utf8', mode: 0o600 });
      } catch {
        /* best-effort */
      }
    })();
  }, 1500);
}

/** Interroge un endpoint « BAN-like » (BAN ou Géoplateforme, même schéma). */
async function queryProvider(base: string, q: string): Promise<LatLon | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${base}?q=${encodeURIComponent(q)}&limit=1`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS-cockpit/geocode' } });
    if (!res.ok) return null;
    const j = (await res.json()) as { features?: { geometry?: { coordinates?: number[] } }[] };
    const coords = j.features?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      const [lon, lat] = coords; // GeoJSON : [lon, lat]
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) return { lat, lon };
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Géocode une localité (cache → BAN → IGN Géoplateforme). null si introuvable. */
export async function geocodeLocality(text: string): Promise<LatLon | null> {
  const q = (text || '').trim();
  if (!q || q.length < 2) return null;
  const key = normKey(q);
  const cache = await ensureCache();
  if (cache.has(key)) return cache.get(key) ?? null;

  // BAN d'abord (proven depuis le VPS), repli IGN Géoplateforme.
  let hit = await queryProvider('https://api-adresse.data.gouv.fr/search/', q);
  if (!hit) hit = await queryProvider('https://data.geopf.fr/geocodage/search', q);

  cache.set(key, hit); // mémorise le résultat (y compris null pour ne pas boucler)
  void persistSoon(cache);
  return hit;
}

/**
 * Enrichit un lot d'objets porteurs d'une localité : remplit lat/lon quand ils
 * manquent et qu'une localité est disponible. Concurrence bornée. Mute en place.
 * `getLocality` renvoie la meilleure chaîne de localité pour un item (ou null).
 */
export async function fillMissingCoords<T extends { lat?: number; lon?: number }>(
  items: T[],
  getLocality: (item: T) => string | null | undefined,
): Promise<number> {
  const todo = items.filter((it) => (typeof it.lat !== 'number' || typeof it.lon !== 'number') && !!getLocality(it));
  let filled = 0;
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < todo.length) {
      const item = todo[idx++];
      const loc = getLocality(item);
      if (!loc) continue;
      const hit = await geocodeLocality(loc);
      if (hit) {
        item.lat = hit.lat;
        item.lon = hit.lon;
        filled += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, () => worker()));
  return filled;
}
