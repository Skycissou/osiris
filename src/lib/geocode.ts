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

// Version du cache : à incrémenter quand la LOGIQUE de géocodage change → les
// échecs (null) mémorisés par l'ancienne logique sont ré-essayés (les succès,
// eux, sont conservés pour épargner le fournisseur). Format : {v, e:{...}}.
const GEOCACHE_VERSION = 2;

async function ensureCache(): Promise<Map<string, LatLon | null>> {
  if (G.__osirisGeocache) return G.__osirisGeocache;
  const map = new Map<string, LatLon | null>();
  try {
    const raw = await fs.readFile(cacheFile(), 'utf8').catch(() => '');
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: number; e?: Record<string, LatLon | null> } | Record<string, LatLon | null>;
      const versioned = parsed && typeof parsed === 'object' && 'e' in parsed && (parsed as { e?: unknown }).e;
      const entries = (versioned ? (parsed as { e: Record<string, LatLon | null> }).e : parsed) as Record<string, LatLon | null>;
      const sameVersion = versioned && (parsed as { v?: number }).v === GEOCACHE_VERSION;
      for (const [k, v] of Object.entries(entries)) {
        const valid = v === null || (v && typeof v.lat === 'number' && typeof v.lon === 'number');
        if (!valid) continue;
        // Version différente/ancienne : on GARDE les succès, on JETTE les null
        // (pour qu'ils soient ré-essayés par la nouvelle logique).
        if (!sameVersion && v === null) continue;
        map.set(k, v);
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
        await fs.writeFile(cacheFile(), JSON.stringify({ v: GEOCACHE_VERSION, e: Object.fromEntries(map) }), { encoding: 'utf8', mode: 0o600 });
      } catch {
        /* best-effort */
      }
    })();
  }, 1500);
}

/** Interroge un endpoint « BAN-like » (BAN ou Géoplateforme, même schéma).
 *  `extra` permet une requête STRUCTURÉE (postcode/type) — bien meilleur taux
 *  que le texte libre pour « Ville (CP) ». */
async function queryProvider(base: string, q: string, extra?: { postcode?: string; type?: string }): Promise<LatLon | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = `${base}?q=${encodeURIComponent(q)}&limit=1`;
    if (extra?.postcode) url += `&postcode=${encodeURIComponent(extra.postcode)}`;
    if (extra?.type) url += `&type=${encodeURIComponent(extra.type)}`;
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

  const BAN = 'https://api-adresse.data.gouv.fr/search/';
  const IGN = 'https://data.geopf.fr/geocodage/search';

  // Parse « Ville (75011) - Région » → ville="Ville", cp="75011". Le texte libre
  // brut fait souvent caler BAN (parenthèses/région parasites) → on privilégie la
  // requête STRUCTURÉE ville+CP (même approche que le parser 116000).
  const cp = q.match(/\b(\d{5})\b/)?.[1] ?? '';
  const city = q
    .replace(/\(.*$/, '') // coupe à la parenthèse
    .replace(/\b\d{5}\b.*$/, '') // ou au code postal
    .replace(/[-–—].*$/, '') // enlève « - Région »
    .replace(/\s+/g, ' ')
    .trim();

  let hit: LatLon | null = null;
  // 1) requête structurée ville + CP (meilleur taux)
  if (city && cp) {
    hit = await queryProvider(BAN, city, { postcode: cp, type: 'municipality' });
    if (!hit) hit = await queryProvider(IGN, city, { postcode: cp, type: 'municipality' });
  }
  // 2) ville seule (si pas de CP mais un nom de commune exploitable)
  if (!hit && city && city.length >= 2 && city !== q) {
    hit = await queryProvider(BAN, city, { type: 'municipality' });
  }
  // 3) repli texte libre (localité complète, ex. adresse précise)
  if (!hit) hit = await queryProvider(BAN, q);
  if (!hit) hit = await queryProvider(IGN, q);

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
