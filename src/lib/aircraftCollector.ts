// ─────────────────────────────────────────────────────────────────────────────
//  aircraftCollector.ts — COLLECTEUR PERMANENT d'avions (serveur only)
//
//  RÉÉCRITURE À ZÉRO de la couche avions (décision Cissou 07/07 : « reprendre
//  cette couche-là à zéro, voir ce que l'app d'origine applique »).
//
//  LE MODÈLE DES APPS FLUIDES (FR24, tar1090…) : l'affichage ne déclenche
//  JAMAIS de téléchargement. Un collecteur tourne en permanence côté serveur,
//  entretient UN état monde en mémoire, et les requêtes de la carte ne font
//  que LIRE cet état (filtré par la vue) → réponse toujours < 10 ms, affichage
//  stable par construction. C'est l'inverse de l'ancienne architecture où
//  chaque requête carte pouvait déclencher 4 téléchargements de 500 Ko qui
//  s'étranglaient mutuellement sur le lien lent du VPS.
//
//  FONCTIONNEMENT :
//    • La route fast DÉCLARE des « zones d'intérêt » (les disques quantifiés
//      de la vue courante) — registerInterest(). Une zone expire au bout de
//      10 min sans visite.
//    • La boucle du collecteur (1 tick / 8 s) télécharge UNE SEULE zone à la
//      fois (round-robin), 30 s de timeout, jamais deux téléchargements en
//      parallèle → doux avec adsb.lol ET avec la bande passante du VPS.
//    • OpenSky (si identifiants) : instantané MONDE rafraîchi ~2 min quand une
//      vue large l'a demandé (registerGlobalInterest).
//    • Les avions vivent dans `state` (clé hex) avec `seenAt` ; un avion non
//      revu depuis 5 min sort de l'affichage (10 min de la mémoire).
//
//  La route lit : getAircraftInBBox(bbox) — pur, synchrone, instantané.
// ─────────────────────────────────────────────────────────────────────────────

import { safeFetch } from '@/lib/ssrf-guard';
import { getGlobalAircraft } from '@/lib/openskyGlobal';
import { recordCall } from '@/lib/telemetry';

/** Avion normalisé (même forme que l'API publique du flux fast). */
export interface CollectedAircraft {
  id: string;
  hex: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  alt?: number;
  callsign?: string;
  category?: string; // classe émetteur ADS-B (A1..C7) → couleur par catégorie
  reg?: string; // immatriculation (adsb.lol `r`)
  acType?: string; // type ICAO appareil (adsb.lol `t`, ex. A320)
  mil?: boolean; // avion militaire (bit 0 de dbFlags)
  squawk?: string; // code transpondeur (7500/7600/7700 = urgence)
  emergency?: string; // état d'urgence déclaré (general/lifeguard/…)
  vip: boolean;
}

interface StoredAircraft extends CollectedAircraft {
  seenAt: number;
}

/** Disque de collecte (sortie de la quantification de la route). */
export interface CollectDisc {
  lat: number;
  lng: number;
  radiusNm: number;
}

// ── Réglages ─────────────────────────────────────────────────────────────────
/** Cadence de la boucle (1 opération réseau MAX par tick). */
const TICK_MS = 8_000;
/** Timeout d'un téléchargement de disque adsb.lol. */
const DISC_TIMEOUT_MS = 30_000;
/** Une zone d'intérêt non revisitée expire (on arrête de la collecter). */
const INTEREST_TTL_MS = 10 * 60_000;
/** Un avion non revu sort de l'AFFICHAGE après… */
const DISPLAY_TTL_MS = 5 * 60_000;
/** …et de la mémoire après (borne la RAM). */
const MEMORY_TTL_MS = 10 * 60_000;
/** Rafraîchissement de l'instantané monde OpenSky. */
const GLOBAL_REFRESH_MS = 120_000;
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

// ── État module — protégé contre les doubles instances (HMR dev) ────────────
type CollectorState = {
  state: Map<string, StoredAircraft>;
  interests: Map<string, { disc: CollectDisc; ts: number }>;
  globalInterestTs: number;
  openskyId: string;
  openskySecret: string;
  lastGlobalAt: number;
  rrIndex: number;
  busy: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

const G = globalThis as unknown as { __osirisAircraftCollector?: CollectorState };
const C: CollectorState = G.__osirisAircraftCollector ?? {
  state: new Map(),
  interests: new Map(),
  globalInterestTs: 0,
  openskyId: process.env.OPENSKY_CLIENT_ID ?? '',
  openskySecret: process.env.OPENSKY_CLIENT_SECRET ?? '',
  lastGlobalAt: 0,
  rrIndex: 0,
  busy: false,
  timer: null,
};
G.__osirisAircraftCollector = C;

// ── API pour la route ────────────────────────────────────────────────────────

/** Déclare les disques que la vue courante veut voir collectés. */
export function registerInterest(discs: CollectDisc[]): void {
  const now = Date.now();
  for (const d of discs) {
    C.interests.set(`${d.lat},${d.lng},${d.radiusNm}`, { disc: d, ts: now });
  }
}

/** Déclare qu'une vue LARGE veut l'instantané monde (OpenSky si identifiants). */
export function registerGlobalInterest(id: string, secret: string): void {
  C.globalInterestTs = Date.now();
  if (id && secret) {
    C.openskyId = id;
    C.openskySecret = secret;
  }
}

/** Lecture PURE de l'état : avions frais (< 5 min) dans la bbox. Instantané. */
export function getAircraftInBBox(
  bbox: [number, number, number, number],
  max: number,
): CollectedAircraft[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const cutoff = Date.now() - DISPLAY_TTL_MS;
  const out: CollectedAircraft[] = [];
  for (const a of C.state.values()) {
    if (a.seenAt < cutoff) continue;
    if (a.lat < minLat || a.lat > maxLat || a.lng < minLng || a.lng > maxLng) continue;
    // Copie SANS seenAt (champ interne au collecteur).
    const { seenAt: _seenAt, ...pub } = a;
    out.push(pub);
    if (out.length >= max) break;
  }
  return out;
}

/** Petit état de santé pour le debug (exposé dans la réponse de la route). */
export function collectorHealth(): { tracked: number; zones: number; lastGlobalAgeS: number | null } {
  return {
    tracked: C.state.size,
    zones: C.interests.size,
    lastGlobalAgeS: C.lastGlobalAt ? Math.round((Date.now() - C.lastGlobalAt) / 1000) : null,
  };
}

/** Démarre la boucle si pas déjà fait (appelé par la route à chaque requête). */
export function ensureCollector(): void {
  if (C.timer) return;
  C.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick(); // première collecte sans attendre le 1er intervalle
}

// ── Boucle de collecte ───────────────────────────────────────────────────────

function mergeAircraft(list: CollectedAircraft[], now: number): void {
  for (const a of list) {
    C.state.set(a.hex, { ...a, seenAt: now });
  }
}

function pruneAll(now: number): void {
  const memCutoff = now - MEMORY_TTL_MS;
  for (const [hex, a] of C.state) if (a.seenAt < memCutoff) C.state.delete(hex);
  const intCutoff = now - INTEREST_TTL_MS;
  for (const [k, v] of C.interests) if (v.ts < intCutoff) C.interests.delete(k);
}

/** Télécharge UN disque adsb.lol → liste normalisée (null si échec). */
async function fetchDisc(disc: CollectDisc): Promise<CollectedAircraft[] | null> {
  const url = `https://api.adsb.lol/v2/point/${disc.lat.toFixed(2)}/${disc.lng.toFixed(2)}/${disc.radiusNm}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISC_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) {
      console.warn(`[OSIRIS avions] adsb.lol ${res.status} sur ${url}`);
      recordCall({ source: 'adsb.lol', ok: false, status: res.status, ms: Date.now() - started });
      return null;
    }
    const payload = (await res.json()) as { ac?: Record<string, unknown>[] };
    const raw = Array.isArray(payload.ac) ? payload.ac : [];
    recordCall({ source: 'adsb.lol', ok: true, status: res.status, ms: Date.now() - started, count: raw.length });
    const out: CollectedAircraft[] = [];
    for (const r of raw) {
      const hex = typeof r.hex === 'string' ? r.hex.trim().toLowerCase() : '';
      const lat = r.lat;
      const lng = r.lon;
      if (!hex || typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let alt: number | undefined;
      if (typeof r.alt_baro === 'number' && Number.isFinite(r.alt_baro)) alt = r.alt_baro;
      else if (typeof r.alt_geom === 'number' && Number.isFinite(r.alt_geom)) alt = r.alt_geom;
      const dbFlags = typeof r.dbFlags === 'number' ? r.dbFlags : 0;
      out.push({
        id: hex,
        hex,
        lat,
        lng,
        heading: typeof r.track === 'number' && Number.isFinite(r.track) ? r.track : undefined,
        speed: typeof r.gs === 'number' && Number.isFinite(r.gs) ? r.gs : undefined,
        alt,
        callsign: typeof r.flight === 'string' && r.flight.trim() ? r.flight.trim() : undefined,
        category: typeof r.category === 'string' && r.category ? r.category : undefined,
        reg: typeof r.r === 'string' && r.r.trim() ? r.r.trim() : undefined,
        acType: typeof r.t === 'string' && r.t.trim() ? r.t.trim() : undefined,
        mil: (dbFlags & 1) === 1, // bit 0 = militaire (convention adsb.lol/tar1090)
        squawk: typeof r.squawk === 'string' && r.squawk.trim() ? r.squawk.trim() : undefined,
        emergency:
          typeof r.emergency === 'string' && r.emergency.trim() && r.emergency !== 'none'
            ? r.emergency.trim()
            : undefined,
        vip: false,
      });
    }
    return out;
  } catch (e) {
    console.warn('[OSIRIS avions] disque KO:', e instanceof Error ? e.message : e);
    recordCall({ source: 'adsb.lol', ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Un tick = AU PLUS une opération réseau (jamais de parallélisme). */
async function tick(): Promise<void> {
  if (C.busy) return;
  C.busy = true;
  try {
    const now = Date.now();
    pruneAll(now);

    // 1) Priorité : instantané MONDE (si demandé récemment + identifiants + dû).
    const wantGlobal =
      now - C.globalInterestTs < INTEREST_TTL_MS &&
      C.openskyId !== '' &&
      C.openskySecret !== '' &&
      now - C.lastGlobalAt > GLOBAL_REFRESH_MS;
    if (wantGlobal) {
      const global = getGlobalAircraft(C.openskyId, C.openskySecret);
      if (Array.isArray(global)) {
        mergeAircraft(global, now);
        C.lastGlobalAt = now;
      }
      // 'warming' → openskyGlobal télécharge déjà en fond ; on retentera.
      return; // une seule opération par tick
    }

    // 2) Sinon : UN disque d'intérêt (round-robin).
    const discs = [...C.interests.values()];
    if (discs.length === 0) return;
    const target = discs[C.rrIndex % discs.length];
    C.rrIndex = (C.rrIndex + 1) % Math.max(1, discs.length);
    const list = await fetchDisc(target.disc);
    if (list) mergeAircraft(list, Date.now());
  } finally {
    C.busy = false;
  }
}
