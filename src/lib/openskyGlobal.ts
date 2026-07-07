// ─────────────────────────────────────────────────────────────────────────────
//  openskyGlobal.ts — Vue MONDIALE des avions via OpenSky Network (serveur only)
//
//  POURQUOI (décision Cissou 07/07, « go A ») : adsb.lol /v2/point est limité à
//  des disques de 250 NM → impossible d'avoir la planète. OpenSky Network offre
//  gratuitement (compte requis) un instantané GLOBAL ~8-12 000 avions via
//  GET /api/states/all. Quota gratuit oblige : on rafraîchit ~toutes les 2 min
//  et on sert le cache entre-temps (l'interpolation client garde le mouvement).
//
//  AUTH (API OpenSky 2025+) : OAuth2 « client credentials » — l'utilisateur crée
//  un client API sur opensky-network.org et fournit client_id + client_secret
//  via la page Clés API (en-têtes x-osiris-key-opensky_id / _secret) ou l'env
//  (OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET). Sans identifiants → null, et
//  la route retombe sur le tuilage adsb.lol (dégradation douce).
//
//  Sortie : MÊME forme que les avions adsb.lol du flux fast (hex/lat/lng/
//  heading/speed kt/alt ft/callsign) → zéro changement client.
// ─────────────────────────────────────────────────────────────────────────────

import { safeFetch } from '@/lib/ssrf-guard';

/** Jeton OAuth2 (client credentials) — realm officiel OpenSky. */
const TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
/** Instantané global : tous les états-vecteurs connus à l'instant t. */
const STATES_URL = 'https://opensky-network.org/api/states/all';
/** Fraîcheur de l'instantané (quota gratuit : ~2 min est raisonnable). */
const SNAPSHOT_TTL_MS = 120_000;
/** Au-delà : trop vieux pour être montré, même en stale. */
const SNAPSHOT_STALE_MAX_MS = 10 * 60_000;
/** Timeout réseau (l'instantané fait plusieurs Mo). */
const TIMEOUT_MS = 30_000;
/** m/s → nœuds (les vitesses OpenSky sont en m/s, adsb.lol en kt). */
const MS_TO_KT = 1.943_84;
/** m → pieds (altitudes OpenSky en mètres, adsb.lol en ft). */
const M_TO_FT = 3.280_84;

/** Avion normalisé — structurellement identique au type du flux fast. */
export interface GlobalAircraft {
  id: string;
  hex: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  alt?: number;
  callsign?: string;
  vip: boolean;
}

// ── Caches module (process Next standalone) ──────────────────────────────────
let tokenCache: { value: string; exp: number } | null = null;
let snapshot: { ts: number; aircraft: GlobalAircraft[] } | null = null;
let inflight: Promise<GlobalAircraft[] | null> | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await safeFetch(url, { ...init, signal: controller.signal, maxRedirects: 2 });
  } finally {
    clearTimeout(timeout);
  }
}

/** Obtient (ou réutilise) un jeton OAuth2. Throw si l'auth échoue. */
async function getToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.exp) return tokenCache.value;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token opensky ${res.status}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('token opensky absent');
  // Marge de 60 s avant l'expiration réelle.
  const ttl = Math.max(60, (json.expires_in ?? 1800) - 60) * 1000;
  tokenCache = { value: json.access_token, exp: Date.now() + ttl };
  return json.access_token;
}

/**
 * Normalise un état-vecteur OpenSky (tableau positionnel documenté) :
 * [0] icao24 · [1] callsign · [5] lon · [6] lat · [7] baro_alt m ·
 * [9] velocity m/s · [10] true_track ° · [13] geo_alt m.
 */
function normalizeState(s: unknown[]): GlobalAircraft | null {
  const hex = typeof s[0] === 'string' ? s[0].trim().toLowerCase() : '';
  const lng = s[5];
  const lat = s[6];
  if (!hex || typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let alt: number | undefined;
  if (typeof s[7] === 'number' && Number.isFinite(s[7])) alt = Math.round(s[7] * M_TO_FT);
  else if (typeof s[13] === 'number' && Number.isFinite(s[13])) alt = Math.round(s[13] * M_TO_FT);

  const callsign = typeof s[1] === 'string' && s[1].trim() ? s[1].trim() : undefined;

  return {
    id: hex,
    hex,
    lat,
    lng,
    heading: typeof s[10] === 'number' && Number.isFinite(s[10]) ? s[10] : undefined,
    speed: typeof s[9] === 'number' && Number.isFinite(s[9]) ? Math.round(s[9] * MS_TO_KT) : undefined,
    alt,
    callsign,
    vip: false, // le tag VIP est posé par la route (enrichVip), comme adsb.lol
  };
}

/** Téléchargement réel de l'instantané global (une passe). */
async function refresh(clientId: string, clientSecret: string): Promise<GlobalAircraft[] | null> {
  try {
    const token = await getToken(clientId, clientSecret);
    const res = await fetchWithTimeout(STATES_URL, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) tokenCache = null; // jeton révoqué → re-auth au prochain tour
    if (!res.ok) return null;
    const json = (await res.json()) as { states?: unknown[][] };
    const states = Array.isArray(json.states) ? json.states : [];
    const aircraft: GlobalAircraft[] = [];
    for (const s of states) {
      const a = Array.isArray(s) ? normalizeState(s) : null;
      if (a) aircraft.push(a);
    }
    snapshot = { ts: Date.now(), aircraft };
    return aircraft;
  } catch {
    return null;
  } finally {
    inflight = null;
  }
}

/**
 * Instantané mondial : cache frais → direct ; périmé (< 10 min) → servi pendant
 * qu'un refresh tourne en fond ; rien → on attend le refresh. null = pas
 * d'identifiants exploitables ou amont KO sans cache (l'appelant retombe sur
 * le tuilage adsb.lol).
 */
export async function getGlobalAircraft(
  clientId: string,
  clientSecret: string,
): Promise<GlobalAircraft[] | null> {
  if (!clientId || !clientSecret) return null;
  const age = snapshot ? Date.now() - snapshot.ts : Number.POSITIVE_INFINITY;
  if (snapshot && age < SNAPSHOT_TTL_MS) return snapshot.aircraft;
  if (!inflight) inflight = refresh(clientId, clientSecret);
  if (snapshot && age < SNAPSHOT_STALE_MAX_MS) return snapshot.aircraft;
  return inflight;
}
