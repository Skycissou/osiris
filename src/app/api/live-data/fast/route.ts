// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — LIVE DATA / FAST : couche « Aérien (temps réel) ».
//
//  Premier flux temps-réel du cockpit. Sert les avions ADS-B visibles dans le
//  viewport, à partir de données PUBLIQUES déjà diffusées (réseau adsb.lol,
//  API gratuite sans clé). Usage strictement VEILLE / situationnel défensif
//  (esprit ARPD) : aucune watchlist nominative, aucun enrichissement VIP ici —
//  uniquement ce que n'importe qui capte déjà sur 1090 MHz.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
//
//  Contrat côté client (voir src/lib/liveData.ts) :
//    GET /api/live-data/fast?bbox=minLng,minLat,maxLng,maxLat
//    → 200 { aircraft, count, ts }  + en-tête ETag (faible, stable)
//    → 304 (corps vide) si If-None-Match == ETag courant
//    Cache-Control: no-store (le conditionnel se gère à l'ETag, pas au cache HTTP).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : données temps-réel, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

// ── Constantes géo / API ───────────────────────────────────────────────────
/** Bbox France métropolitaine par défaut [minLng, minLat, maxLng, maxLat]. */
const DEFAULT_BBOX: BBox = [-5.5, 41, 9.8, 51.5];
/** Rayon max accepté par l'endpoint /v2/point d'adsb.lol (nautical miles). */
const MAX_RADIUS_NM = 250;
/** Rayon plancher : sous ce seuil un viewport très zoomé ne renvoie rien. */
const MIN_RADIUS_NM = 5;
/** 1 mille nautique en mètres. */
const NM_IN_METERS = 1852;
/** Rayon moyen terrestre (m). */
const EARTH_RADIUS_M = 6_371_000;
const DEG2RAD = Math.PI / 180;
/** Timeout réseau vers adsb.lol. */
const FETCH_TIMEOUT_MS = 8_000;
/** User-Agent identifiant l'appelant, exigé par l'étiquette adsb.lol. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

// ── Types ───────────────────────────────────────────────────────────────────
/** Emprise géographique [minLng, minLat, maxLng, maxLat] (ordre GeoJSON). */
type BBox = [number, number, number, number];

/** Avion normalisé, format compact consommé par la carte. */
interface Aircraft {
  id: string; // hex ICAO24 (identifiant stable)
  lat: number;
  lng: number;
  heading?: number; // cap sol (deg)
  speed?: number; // vitesse sol (nœuds)
  alt?: number; // altitude (ft), baro sinon géométrique
  callsign?: string; // indicatif de vol (flight, trimé)
  hex: string; // hex ICAO24 brut
  category?: string; // catégorie ADS-B (A1..C7…) si diffusée
}

/**
 * Sous-ensemble des champs adsb.lol qui nous intéressent. L'API renvoie bien
 * d'autres clés ; on reste tolérant (tout est optionnel, on filtre après).
 */
interface RawAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  track?: number;
  gs?: number;
  alt_baro?: number | string; // parfois "ground"
  alt_geom?: number;
  category?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Parse le paramètre `bbox` (`minLng,minLat,maxLng,maxLat`). Renvoie la bbox
 * par défaut si absent ou invalide (4 nombres finis, ordre min<max toléré/normalisé).
 */
function parseBBox(raw: string | null): BBox {
  if (!raw) return DEFAULT_BBOX;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return DEFAULT_BBOX;
  let [minLng, minLat, maxLng, maxLat] = parts;
  // Normalise l'ordre au cas où le client enverrait les coins inversés.
  if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  // Garde-fous de domaine géographique.
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return DEFAULT_BBOX;
  return [minLng, minLat, maxLng, maxLat];
}

/** Distance haversine en mètres entre deux points (lat/lng en degrés). */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLng = (lng2 - lng1) * DEG2RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Depuis une bbox, dérive le centre + un rayon en NM couvrant toute l'emprise.
 * L'API /v2/point renvoie un DISQUE ; on prend le rayon = distance centre→coin
 * (donc le disque circonscrit la bbox), plafonné à MAX_RADIUS_NM. On filtrera
 * ensuite sur la bbox réelle pour retirer le surplus circulaire.
 */
function bboxToPoint(bbox: BBox): { lat: number; lng: number; radiusNm: number } {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lat = (minLat + maxLat) / 2;
  const lng = (minLng + maxLng) / 2;
  // Distance jusqu'au coin le plus éloigné (les 4 coins par symétrie ≈ égaux,
  // on prend un coin franc).
  const cornerM = haversineMeters(lat, lng, maxLat, maxLng);
  let radiusNm = Math.ceil(cornerM / NM_IN_METERS);
  radiusNm = Math.max(MIN_RADIUS_NM, Math.min(MAX_RADIUS_NM, radiusNm));
  return { lat, lng, radiusNm };
}

/** Un point (lat,lng) est-il dans la bbox ? */
function inBBox(lat: number, lng: number, bbox: BBox): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

/**
 * Normalise un avion brut adsb.lol → format compact. Renvoie null si l'avion
 * n'a pas de position exploitable (on ne peut rien afficher sans lat/lng).
 */
function normalize(raw: RawAircraft): Aircraft | null {
  const hex = typeof raw.hex === 'string' ? raw.hex.trim().toLowerCase() : '';
  const lat = raw.lat;
  const lng = raw.lon;
  if (!hex || typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Altitude : baro d'abord (peut valoir "ground" → on ignore la string),
  // sinon géométrique.
  let alt: number | undefined;
  if (typeof raw.alt_baro === 'number' && Number.isFinite(raw.alt_baro)) alt = raw.alt_baro;
  else if (typeof raw.alt_geom === 'number' && Number.isFinite(raw.alt_geom)) alt = raw.alt_geom;

  const callsign =
    typeof raw.flight === 'string' && raw.flight.trim() ? raw.flight.trim() : undefined;

  return {
    id: hex,
    hex,
    lat,
    lng,
    heading: typeof raw.track === 'number' && Number.isFinite(raw.track) ? raw.track : undefined,
    speed: typeof raw.gs === 'number' && Number.isFinite(raw.gs) ? raw.gs : undefined,
    alt,
    callsign,
    category: typeof raw.category === 'string' && raw.category ? raw.category : undefined,
  };
}

/**
 * ETag faible, stable et bon-marché : ne dépend QUE du contenu (count + somme
 * des positions arrondies + indicatifs), jamais de l'horloge. Deux réponses au
 * même état renvoient le même ETag → 304 possible ; un mouvement notable le
 * change. Arrondi à ~0.01° (≈1 km) pour éviter un ETag qui gigote au bruit GPS.
 */
function computeETag(list: Aircraft[]): string {
  let acc = 0;
  for (const a of list) {
    // Combine position arrondie + altitude ; hash entier simple (FNV-ish léger).
    const latQ = Math.round(a.lat * 100);
    const lngQ = Math.round(a.lng * 100);
    const altQ = a.alt != null ? Math.round(a.alt / 100) : 0;
    let h = 2166136261;
    for (const ch of a.hex) h = (h ^ ch.charCodeAt(0)) * 16777619;
    h = (h ^ latQ) * 16777619;
    h = (h ^ lngQ) * 16777619;
    h = (h ^ altQ) * 16777619;
    // >>> 0 pour rester en entier non signé 32 bits, addition modulo 2^32.
    acc = (acc + (h >>> 0)) % 0x100000000;
  }
  return `W/"${list.length}-${acc.toString(36)}"`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const bbox = parseBBox(request.nextUrl.searchParams.get('bbox'));
  const { lat, lng, radiusNm } = bboxToPoint(bbox);

  // adsb.lol /v2/point/{lat}/{lon}/{radius_nm} — données publiques, pas de clé.
  const upstream = `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lng.toFixed(4)}/${radiusNm}`;

  let payload: { ac?: RawAircraft[] } | null = null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // safeFetch : garde SSRF (valide l'hôte, re-valide chaque redirection).
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      maxRedirects: 2,
    });
    if (!res.ok) {
      // Amont en panne / rate-limit : dégradation douce. Le client attend un
      // JSON mergeable ; on renvoie une couche vide plutôt que de casser le
      // polling. On la marque no-store et non conditionnable (pas d'ETag).
      return NextResponse.json(
        { aircraft: [], count: 0, ts: Date.now(), error: `amont adsb.lol ${res.status}` },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    payload = (await res.json()) as { ac?: RawAircraft[] };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      {
        aircraft: [],
        count: 0,
        ts: Date.now(),
        error: aborted ? 'timeout adsb.lol' : 'échec réseau adsb.lol',
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }

  // Normalise + filtre sur la bbox RÉELLE (l'API renvoie un disque).
  const raw = Array.isArray(payload?.ac) ? payload!.ac : [];
  const aircraft: Aircraft[] = [];
  for (const r of raw) {
    const a = normalize(r);
    if (a && inBBox(a.lat, a.lng, bbox)) aircraft.push(a);
  }

  // ETag conditionnel : si le client renvoie le même → 304 sans corps.
  const etag = computeETag(aircraft);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    { aircraft, count: aircraft.length, ts: Date.now() },
    {
      status: 200,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    },
  );
}
