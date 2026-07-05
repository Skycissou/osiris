// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — LIVE DATA / SLOW : couches géophysiques (flux « lent »).
//
//  Second flux du cockpit, poll toutes les 120 s côté client (voir
//  src/lib/liveData.ts). Agrège trois couches d'aléas naturels, à partir de
//  données PUBLIQUES ouvertes, pour un usage strictement VEILLE / situationnel
//  défensif (esprit ARPD). Aucune donnée personnelle : phénomènes naturels.
//
//  Quatre couches renvoyées (les CLÉS du body = noms de couches, exigé par
//  mergeData côté client) :
//    • earthquakes — séismes < 24 h, USGS (source RÉELLE, gratuite, sans clé).
//                    C'est la couche démo qui DOIT fonctionner hors-ligne de clé.
//    • wildfires   — feux actifs NASA FIRMS (NÉCESSITE une clé FIRMS_MAP_KEY ;
//                    absente → couche vide, la route ne casse pas).
//    • volcanoes   — pas d'API no-key fiable → [] + TODO documenté (voir plus bas).
//    • satellites  — positions SGP4 (temps réel) de satellites notables, TLE
//                    Celestrak PUBLICS et SANS clé. Source/calcul KO → [].
//                    Calcul délégué à src/lib/satellites.ts (fonctions pures).
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet. Calquée sur
//  le style de la route /fast (SSRF-guard safeFetch, ETag/304 dérivé du
//  contenu — jamais de Date.now dans l'ETag —, Cache-Control no-store,
//  dégradation douce : une source en panne renvoie une couche vide, jamais un
//  500 qui casserait le polling).
//
//  Contrat côté client :
//    GET /live-feed/slow[?bbox=minLng,minLat,maxLng,maxLat]
//    → 200 { earthquakes, wildfires, volcanoes, satellites, ts } + en-tête ETag
//    → 304 (corps vide) si If-None-Match == ETag courant
//
//  bbox : ces couches sont GLOBALES / nationales (USGS « all_day » = monde
//  entier, FIRMS area « world »). La route ACCEPTE le param bbox sans planter
//  mais l'IGNORE volontairement — le filtrage géographique se fait côté carte
//  (viewport). Choix documenté : garder l'ETag stable par ressource, pas par
//  emprise (sinon chaque pan invaliderait le cache d'une couche pourtant
//  identique). Cohérent avec liveData.ts qui ne scope pas 'slow' par défaut.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';
import { computeSatellites, SATS_SUIVIS, type SatPosition } from '@/lib/satellites';

// Toujours dynamique : données temps quasi-réel, jamais de pré-rendu statique.
export const dynamic = 'force-dynamic';

// ── Constantes sources / réseau ─────────────────────────────────────────────
/** Flux USGS « tous séismes des dernières 24 h », GeoJSON, public sans clé. */
const USGS_ALL_DAY =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
/**
 * Endpoint NASA FIRMS « area CSV » monde, capteur VIIRS S-NPP NRT, fenêtre 1 j.
 * {KEY} = FIRMS_MAP_KEY (clé gratuite obtenue sur firms.modaps.eosdis.nasa.gov).
 * Sans clé → on n'appelle même pas et la couche wildfires est vide.
 */
const FIRMS_AREA_CSV_TMPL =
  'https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/VIIRS_SNPP_NRT/world/1';
/** Plafond de points feux retenus (protège le client d'un CSV énorme). */
const FIRMS_MAX_POINTS = 2000;
/**
 * Endpoint Celestrak « GP » (General Perturbations) au format TLE, PUBLIC et
 * SANS clé. {CATNR} = numéro de catalogue NORAD du satellite suivi. Renvoie 3
 * lignes (nom + 2 lignes TLE) par satellite. Doc : celestrak.org/NORAD/documentation.
 */
const CELESTRAK_GP_TMPL =
  'https://celestrak.org/NORAD/elements/gp.php?CATNR={CATNR}&FORMAT=tle';
/** Timeout réseau par source (ms). */
const FETCH_TIMEOUT_MS = 10_000;
/** User-Agent identifiant l'appelant (étiquette réseau, cohérent avec /fast). */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

// ── Types normalisés (format compact consommé par la carte) ─────────────────

/** Séisme normalisé. */
interface Earthquake {
  id: string; // id USGS (stable)
  lat: number;
  lng: number;
  mag: number | null; // magnitude (peut être null côté USGS)
  depth: number | null; // profondeur (km, + = sous la surface)
  place: string; // libellé humain (« 12 km NE de … »)
  time: number; // epoch ms (properties.time)
}

/** Feu actif normalisé (FIRMS). */
interface Wildfire {
  id: string; // synthétique (lat/lng/time) — FIRMS ne fournit pas d'id stable
  lat: number;
  lng: number;
  bright: number | null; // température de brillance (K) — indicateur d'intensité
  time: string; // date+heure d'acquisition ('YYYY-MM-DD HH:MM')
}

/** Volcan normalisé (structure PRÉVUE — couche vide pour l'instant, voir TODO). */
interface Volcano {
  id: string;
  lat: number;
  lng: number;
  name: string;
  status: string; // ex. état d'activité (« eruption », « unrest »…)
}

// ── Types bruts USGS (sous-ensemble utile) ──────────────────────────────────
interface UsgsFeature {
  id?: string;
  properties?: { mag?: number | null; place?: string | null; time?: number | null };
  geometry?: { coordinates?: [number, number, number] }; // [lng, lat, depth]
}
interface UsgsFeed {
  features?: UsgsFeature[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch tolérant d'une source externe via safeFetch (garde SSRF). Renvoie le
 * texte brut sur 200, ou null en cas d'échec (statut ≠ 200, timeout, réseau).
 * Ne JETTE jamais : chaque couche dégrade en silence (couche vide) pour ne pas
 * casser le polling global — une source morte ne doit pas tuer les deux autres.
 */
/**
 * Clé effective d'un service. Priorité à l'en-tête HTTP fourni par l'utilisateur
 * (`x-osiris-key-<service>`) — Cissou peut ainsi renseigner sa clé depuis l'app
 * sans redéployer — sinon repli sur la variable d'env. '' si ni l'un ni l'autre
 * (dégradation douce inchangée : la couche reste vide, jamais un 500).
 */
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) || (env ? process.env[env] : undefined) || '';

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Normalise le feed USGS GeoJSON → Earthquake[]. lng/lat/depth proviennent de
 * geometry.coordinates ([lng, lat, depth] — ordre GeoJSON) ; mag/place/time de
 * properties. Ignore toute feature sans coordonnées exploitables.
 */
function parseUsgs(text: string): Earthquake[] {
  let feed: UsgsFeed;
  try {
    feed = JSON.parse(text) as UsgsFeed;
  } catch {
    return []; // JSON invalide → couche vide (dégradation douce)
  }
  const features = Array.isArray(feed.features) ? feed.features : [];
  const out: Earthquake[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat, depth] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const p = f.properties ?? {};
    out.push({
      id: typeof f.id === 'string' && f.id ? f.id : `${lat},${lng},${p.time ?? ''}`,
      lat,
      lng,
      mag: typeof p.mag === 'number' && Number.isFinite(p.mag) ? p.mag : null,
      depth: typeof depth === 'number' && Number.isFinite(depth) ? depth : null,
      place: typeof p.place === 'string' ? p.place : '',
      time: typeof p.time === 'number' && Number.isFinite(p.time) ? p.time : 0,
    });
  }
  return out;
}

/**
 * Parse le CSV FIRMS « area » → Wildfire[]. Format attendu (en-tête en 1re
 * ligne) : latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,…
 * On lit dynamiquement les colonnes via l'en-tête (robuste aux variations
 * d'ordre entre capteurs). Limite à FIRMS_MAX_POINTS. Parser CSV minimal :
 * les champs FIRMS ne contiennent pas de virgule échappée, un split direct
 * suffit — pas de dépendance externe.
 */
function parseFirmsCsv(text: string): Wildfire[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return []; // en-tête seul ou vide → rien
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const iLat = header.indexOf('latitude');
  const iLng = header.indexOf('longitude');
  // Brillance : selon le produit la colonne s'appelle bright_ti4 (VIIRS) ou
  // brightness (MODIS). On prend la première disponible.
  const iBright = header.indexOf('bright_ti4') !== -1 ? header.indexOf('bright_ti4') : header.indexOf('brightness');
  const iDate = header.indexOf('acq_date');
  const iTime = header.indexOf('acq_time');
  if (iLat === -1 || iLng === -1) return []; // format inattendu → couche vide

  const out: Wildfire[] = [];
  for (let i = 1; i < lines.length && out.length < FIRMS_MAX_POINTS; i++) {
    const cols = lines[i].split(',');
    const lat = Number(cols[iLat]);
    const lng = Number(cols[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const bright = iBright !== -1 ? Number(cols[iBright]) : NaN;
    // acq_time est un HHMM sans séparateur (ex. '1342') : on le formate lisible.
    const date = iDate !== -1 ? (cols[iDate] ?? '').trim() : '';
    const rawT = iTime !== -1 ? (cols[iTime] ?? '').trim() : '';
    const hhmm = rawT.padStart(4, '0');
    const time = date ? `${date} ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}` : '';
    out.push({
      id: `${lat},${lng},${time}`,
      lat,
      lng,
      bright: Number.isFinite(bright) ? bright : null,
      time,
    });
  }
  return out;
}

/**
 * ETag faible dérivé UNIQUEMENT du contenu (comptes + agrégats de position),
 * jamais de l'horloge — même principe que la route /fast. Deux réponses au même
 * état → même ETag → 304 possible. Hash entier bon-marché (FNV-ish 32 bits).
 */
function computeETag(
  eq: Earthquake[],
  wf: Wildfire[],
  vo: Volcano[],
  sa: SatPosition[],
): string {
  let acc = 0;
  const mix = (n: number) => {
    // Repli d'un entier dans l'accumulateur (modulo 2^32).
    let h = (acc ^ Math.round(n)) >>> 0;
    h = (h * 16777619) >>> 0;
    acc = h;
  };
  for (const e of eq) {
    mix(e.lat * 100);
    mix(e.lng * 100);
    mix((e.mag ?? 0) * 10);
  }
  for (const w of wf) {
    mix(w.lat * 100);
    mix(w.lng * 100);
  }
  for (const v of vo) {
    mix(v.lat * 100);
    mix(v.lng * 100);
  }
  // Les satellites bougent en permanence : leur position change à chaque tick,
  // donc l'ETag varie de fait à chaque poll tant qu'un satellite est visible.
  // C'est VOULU (temps réel) — le 304 ne joue que si aucune couche n'a bougé,
  // ce qui n'arrive que si la couche satellites est vide/figée.
  for (const s of sa) {
    mix(s.lat * 100);
    mix(s.lng * 100);
    mix(s.alt);
  }
  return `W/"eq${eq.length}-wf${wf.length}-vo${vo.length}-sa${sa.length}-${acc.toString(36)}"`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // On lit le param bbox pour ne pas planter s'il est fourni, mais on ne
  // l'exploite pas (couches globales/nationales — voir en-tête du fichier).
  void request.nextUrl.searchParams.get('bbox');

  // ── 1) SÉISMES — USGS (source réelle, la couche démo qui doit marcher) ────
  const usgsText = await fetchText(USGS_ALL_DAY);
  const earthquakes: Earthquake[] = usgsText ? parseUsgs(usgsText) : [];

  // ── 2) FEUX — NASA FIRMS (nécessite FIRMS_MAP_KEY, sinon couche vide) ─────
  //  Clé gratuite : https://firms.modaps.eosdis.nasa.gov/api/map_key/
  //  Absente → on n'appelle PAS l'API et on renvoie []. La route ne casse pas.
  let wildfires: Wildfire[] = [];
  // Clé effective : en-tête user `x-osiris-key-firms` OU env FIRMS_MAP_KEY (voir
  // keyOf). Absente → on n'appelle PAS l'API, couche wildfires vide.
  const firmsKey = keyOf(request, 'firms', 'FIRMS_MAP_KEY');
  if (firmsKey) {
    const firmsUrl = FIRMS_AREA_CSV_TMPL.replace('{KEY}', encodeURIComponent(firmsKey));
    const firmsText = await fetchText(firmsUrl);
    if (firmsText) wildfires = parseFirmsCsv(firmsText);
  }

  // ── 3) VOLCANS — pas d'API no-key fiable → couche vide (structure prévue) ──
  //  TODO(humain/agent) : brancher une source publique de volcanisme actif.
  //  Piste documentée : Smithsonian Global Volcanism Program « Weekly Report »
  //  (volcano.si.edu / bulletins hebdo). Pas de JSON no-key officiel stable à
  //  ce jour → à scraper/normaliser proprement en forme 2, hors périmètre ici.
  //  Cible de normalisation : { id, lat, lng, name, status }.
  const volcanoes: Volcano[] = [];

  // ── 4) SATELLITES — TLE Celestrak (public, sans clé) + propagation SGP4 ────
  //  Pour chaque satellite de SATS_SUIVIS (seed extensible, cf. satellites.ts),
  //  on récupère son TLE par numéro de catalogue NORAD, on concatène tous les
  //  blobs, puis on délègue le parsing + la propagation au helper pur
  //  computeSatellites(). Fetchs en parallèle (poignée de sats, poll 120 s).
  //  Dégradation douce : une source morte → ce satellite manque simplement ;
  //  toutes mortes ou lib qui jette → satellites = []. Jamais de 500.
  let satellites: SatPosition[] = [];
  try {
    const tleTexts = await Promise.all(
      SATS_SUIVIS.map((s) =>
        fetchText(CELESTRAK_GP_TMPL.replace('{CATNR}', encodeURIComponent(s.id))),
      ),
    );
    // On ne garde que les réponses non nulles, on les recolle en un seul blob.
    const blob = tleTexts.filter((t): t is string => t !== null).join('\n');
    if (blob.trim().length > 0) {
      // Instant unique partagé par tous les satellites (cohérence temporelle).
      satellites = computeSatellites(blob, new Date());
    }
  } catch {
    satellites = []; // toute erreur inattendue → couche vide, la route tient
  }

  // ── ETag conditionnel : 304 si le client renvoie l'ETag courant ───────────
  const etag = computeETag(earthquakes, wildfires, volcanoes, satellites);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    { earthquakes, wildfires, volcanoes, satellites, ts: Date.now() },
    {
      status: 200,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    },
  );
}
