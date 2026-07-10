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

// Version du cache : à incrémenter quand la LOGIQUE de géocodage change. En v3
// on a corrigé les FAUX points (BAN franco-français « rapprochait » AUCKLAND/LIMA
// vers une commune FR) → ces succès ERRONÉS doivent être ré-évalués, donc à un
// changement de version on repart de ZÉRO (on ne garde aucune entrée). Format {v,e}.
const GEOCACHE_VERSION = 4;

async function ensureCache(): Promise<Map<string, LatLon | null>> {
  if (G.__osirisGeocache) return G.__osirisGeocache;
  const map = new Map<string, LatLon | null>();
  try {
    const raw = await fs.readFile(cacheFile(), 'utf8').catch(() => '');
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: number; e?: Record<string, LatLon | null> };
      // Seulement si la version correspond (sinon reset total → re-géocodage propre).
      if (parsed && parsed.v === GEOCACHE_VERSION && parsed.e) {
        for (const [k, v] of Object.entries(parsed.e)) {
          if (v === null || (v && typeof v.lat === 'number' && typeof v.lon === 'number')) map.set(k, v);
        }
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

interface GeoResult extends LatLon {
  score: number; // 0..1 (BAN) — confiance du match
  label: string; // libellé retourné (ex. « Dijon ») pour valider le nom
}

/** Normalise pour comparaison (minuscule, sans accents/ponctuation). */
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Le libellé retourné correspond-il vraiment à la localité demandée ? Bloque les
 *  faux rapprochements franco-français (AUCKLAND→Auchel, LIMA→Lyon). */
function labelMatches(query: string, label: string): boolean {
  const q = norm(query);
  const r = norm(label);
  if (!q || !r) return false;
  if (r.includes(q) || q.includes(r)) return true;
  const rWords = new Set(r.split(' ').filter((w) => w.length >= 4));
  return q.split(' ').filter((w) => w.length >= 4).some((w) => rWords.has(w) || r.includes(w));
}

/** Interroge un endpoint « BAN-like » (BAN ou Géoplateforme, France uniquement).
 *  Renvoie coords + score + libellé pour validation. `extra` = requête structurée. */
async function queryBan(base: string, q: string, extra?: { postcode?: string; type?: string }): Promise<GeoResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = `${base}?q=${encodeURIComponent(q)}&limit=1`;
    if (extra?.postcode) url += `&postcode=${encodeURIComponent(extra.postcode)}`;
    if (extra?.type) url += `&type=${encodeURIComponent(extra.type)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS-cockpit/geocode' } });
    if (!res.ok) return null;
    const j = (await res.json()) as { features?: { geometry?: { coordinates?: number[] }; properties?: { score?: number; label?: string; name?: string; city?: string } }[] };
    const f = j.features?.[0];
    const coords = f?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2 && Number.isFinite(coords[0]) && Number.isFinite(coords[1])) {
      const [lon, lat] = coords;
      const p = f?.properties || {};
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon, score: typeof p.score === 'number' ? p.score : 0, label: p.label || p.name || p.city || '' };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Nominatim (OSM) = géocodeur MONDIAL pour les lieux hors France. Politesse : 1
// requête/~1,2 s max + User-Agent identifiant (règle d'usage OSM). Cache → rare.
let nominatimNext = 0;
async function queryNominatim(q: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const now = Date.now();
  const wait = Math.max(0, nominatimNext - now);
  nominatimNext = (wait > 0 ? nominatimNext : now) + 1200;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS-cockpit/1.0 (cissouhub.cloud; ARPD OSINT)' } });
    if (!res.ok) return null;
    const arr = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[];
    const it = Array.isArray(arr) ? arr[0] : undefined;
    const lat = it ? Number(it.lat) : NaN;
    const lon = it ? Number(it.lon) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, label: it?.display_name || '' };
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

  // Géocodeur FRANCE = IGN Géoplateforme. L'ancien BAN (api-adresse.data.gouv.fr)
  // est DÉCOMMISSIONNÉ (redirection IGN stoppée le 14/04/2026) → on ne l'appelle plus.
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

  const cityForMatch = city || q;
  // Un résultat BAN n'est ACCEPTÉ que si le score est correct ET que le libellé
  // correspond vraiment → bloque les faux rapprochements FR (AUCKLAND→Pas-de-Calais).
  const tryBan = async (base: string, query: string, extra?: { postcode?: string; type?: string }): Promise<LatLon | null> => {
    const r = await queryBan(base, query, extra);
    if (r && r.score >= 0.35 && labelMatches(cityForMatch, r.label)) return { lat: r.lat, lon: r.lon };
    return null;
  };

  let hit: LatLon | null = null;
  // 1) FRANCE (IGN Géoplateforme) — structuré ville+CP, puis ville, puis texte libre.
  if (city && cp) hit = await tryBan(IGN, city, { postcode: cp, type: 'municipality' });
  if (!hit && city.length >= 2) hit = await tryBan(IGN, city, { type: 'municipality' });
  if (!hit) hit = await tryBan(IGN, q);

  // 2) MONDE (Nominatim) — pour les disparus FR à l'étranger (AUCKLAND, LIMA…).
  //    Validé par le nom aussi → pas de faux point. Échoue → pas de pin (liste).
  if (!hit) {
    const nm = await queryNominatim(q);
    if (nm && labelMatches(cityForMatch, nm.label)) hit = { lat: nm.lat, lon: nm.lon };
  }

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
