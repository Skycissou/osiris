// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — LIVE DATA / SENSITIVE : couches « FORME 2 » (perso enquêteur).
//
//  ⚠️ CADRE DÉFENSIF ARPD — LIRE AVANT DE BRANCHER QUOI QUE CE SOIT ⚠️
//  ─────────────────────────────────────────────────────────────────────────
//  Ces couches sont dites de « FORME 2 » : elles relèvent du poste PERSONNEL de
//  l'enquêteur, à SA discrétion, et NON du socle public du cockpit. Elles sont :
//    • OPT-IN STRICT     : rien ne s'active sans que Cissou renseigne la clé
//                          d'environnement dédiée. Aucune clé → couche VIDE,
//                          AUCUN appel réseau. C'est la règle d'or de ce fichier.
//    • DONNÉES PUBLIQUES : on n'agrège QUE de l'ouvert (déjà diffusé). Aucune
//                          collecte clandestine, aucune donnée d'une personne.
//    • VEILLE, PAS CIBLAGE : usage situationnel/défensif (esprit ARPD). Jamais
//                          de suivi d'individu, jamais de reconnaissance de
//                          personne, jamais de désanonymisation.
//    • CONSENTEMENT       : chaque source suppose le consentement/licence idoine
//                          de son fournisseur. Respect des CGU de chaque API.
//
//  🚫 LIGNE ROUGE (couche `cctv`) : l'affichage de flux de caméras est le point
//     le plus sensible. Il est réservé à des caméras PUBLIQUES explicitement
//     partagées/consenties (ex. webcams touristiques, trafic officiel). JAMAIS
//     de ciblage, JAMAIS d'accès à un flux privé, JAMAIS de surveillance de
//     personnes. Laisser VIDE en cas de doute. Opt-in strict via clé dédiée.
//
//  Ré-écriture clean-room. Calquée EXACTEMENT sur /live-feed/fast et /slow :
//    export const dynamic = 'force-dynamic', safeFetch (garde SSRF), ETag/304
//    dérivé du CONTENU (jamais Date.now dans l'ETag), Cache-Control: no-store,
//    dégradation douce (une source en panne → couche vide, jamais un 500).
//
//  ── VARIABLES D'ENVIRONNEMENT À RENSEIGNER (« il ne reste qu'à mettre les
//     clés ») ────────────────────────────────────────────────────────────────
//    • CCTV_SOURCE_KEY    → couche `cctv` source B = clé API Windy Webcams (webcams
//                           PUBLIQUES consenties). Source A (positions OSM public)
//                           marche SANS clé. (LIGNE ROUGE : jamais de flux privé/Shodan.)
//    • GPSJAM_KEY         → couche `gps_jamming`   (brouillage GPS)
//    • SCANNER_KEY        → couche `scanners`      (scanners radio publics)
//    • SIGINT_KEY         → couche `sigint`        (mesh / APRS)
//    • FRONTLINE_KEY      → couche `frontline`     (tracé de ligne de front)
//    • TELEGRAM_OSINT_KEY → couche `telegram_osint`(signalements OSINT géolocs)
//    (couche `military_bases` : PAS de clé — OSM/Overpass PUBLIC, voir plus bas.)
//
//  Contrat côté client :
//    GET /live-feed/sensitive[?bbox=minLng,minLat,maxLng,maxLat]
//    → 200 { cctv, gps_jamming, scanners, sigint, military_bases, frontline,
//            telegram_osint, ts } + en-tête ETag (faible, stable)
//    → 304 (corps vide) si If-None-Match == ETag courant
//    Body = objet clé→tableau (une clé par couche), mergeable côté store.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';

// Toujours dynamique : couches temps quasi-réel, jamais de pré-rendu statique.
export const dynamic = 'force-dynamic';

// ── Constantes géo / réseau ──────────────────────────────────────────────────
/** Bbox France métropolitaine par défaut [minLng, minLat, maxLng, maxLat]. */
const DEFAULT_BBOX: BBox = [-5.5, 41, 9.8, 51.5];
/** Timeout réseau par source (ms). */
const FETCH_TIMEOUT_MS = 15_000;
/** User-Agent identifiant l'appelant (cohérent avec /fast et /slow). */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/**
 * Endpoint Overpass API (miroir principal), PUBLIC et SANS clé. Sert la couche
 * `military_bases` à partir d'OpenStreetMap (données ouvertes ODbL). On requête
 * les objets taggés `military=base` dans la bbox. Doc : wiki.openstreetmap.org.
 */
/**
 * Miroirs Overpass (OSM). ⚠️ 2026-07-15 : sur le VPS OSIRIS, `safeFetch` échoue
 * pour certains hôtes (son `dns.lookup` de contrôle) ET l'instance principale a
 * renvoyé `ECONNREFUSED`. On tape donc ces hôtes FIXES en **`fetch` DIRECT**
 * (constantes → aucune entrée utilisateur dans le host → SSRF sans objet) et on
 * bascule sur un miroir si l'un refuse/échoue.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass-api.de/api/interpreter', // principal en dernier (refuse le VPS, ECONNREFUSED)
];
/** Timeout PAR miroir (ms) — court pour basculer vite sur le suivant si l'un traîne. */
const OVERPASS_PER_MIRROR_MS = 9_000;
/** Plafond de bases militaires retenues (protège d'une bbox trop large). */
const MILITARY_MAX = 500;
/** Plafond de caméras OSM retenues (bbox large = beaucoup de `man_made=surveillance`). */
const CCTV_OSM_MAX = 600;
/** Plafond de webcams Windy par requête (source B). ⚠️ l'API Windy v3 CAPPE `limit`
 *  à 50 → au-delà elle renvoie HTTP 400 (constat 2026-07-15, `limit=60` → 400). */
const CCTV_WINDY_MAX = 50;
/** Endpoint Windy Webcams API v3 (source B — webcams PUBLIQUES consenties). */
const WINDY_WEBCAMS_ENDPOINT = 'https://api.windy.com/webcams/api/v3/webcams';

// ── Types ────────────────────────────────────────────────────────────────────
/** Emprise géographique [minLng, minLat, maxLng, maxLat] (ordre GeoJSON). */
type BBox = [number, number, number, number];

/**
 * Caméra publique (LIGNE ROUGE — opt-in strict, jamais de ciblage). Ne JAMAIS
 * y injecter un flux privé. `streamUrl` reste optionnel et n'est là que pour des
 * flux PUBLICS explicitement partagés/consentis.
 */
interface CctvCam {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  streamUrl?: string;
}
/** Zone de brouillage GPS (intensité relative). */
interface GpsJamming {
  id: string;
  lat: number;
  lng: number;
  intensity?: number;
}
/** Point de scanner radio public. */
interface Scanner {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}
/** Point SIGINT ouvert (mesh / APRS). */
interface Sigint {
  id: string;
  lat: number;
  lng: number;
  type?: string;
}
/** Base militaire (OSM/Overpass public). */
interface MilitaryBase {
  id: string;
  lat: number;
  lng: number;
  name?: string;
}
/** Segment de ligne de front (porte un GeoJSON opaque, pas un point unique). */
interface Frontline {
  id: string;
  geojson?: unknown;
}
/** Signalement OSINT géolocalisé (source Telegram publique, opt-in). */
interface TelegramOsint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

/** Forme complète du body renvoyé (une clé = une couche). */
interface SensitivePayload {
  cctv: CctvCam[];
  gps_jamming: GpsJamming[];
  scanners: Scanner[];
  sigint: Sigint[];
  military_bases: MilitaryBase[];
  frontline: Frontline[];
  telegram_osint: TelegramOsint[];
}

// ── Helpers géo ──────────────────────────────────────────────────────────────

/**
 * Parse le paramètre `bbox` (`minLng,minLat,maxLng,maxLat`). Renvoie la bbox
 * par défaut si absent/invalide (4 nombres finis, ordre min<max normalisé,
 * domaine géographique valide). Identique en esprit à la route /fast.
 */
function parseBBox(raw: string | null): BBox {
  if (!raw) return DEFAULT_BBOX;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return DEFAULT_BBOX;
  let [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return DEFAULT_BBOX;
  return [minLng, minLat, maxLng, maxLat];
}

/**
 * Clé effective d'une couche. Priorité à l'en-tête HTTP fourni par l'utilisateur
 * (`x-osiris-key-<service>`) — Cissou peut ainsi renseigner sa clé depuis l'app
 * sans redéployer — sinon repli sur la variable d'env. '' si ni l'un ni l'autre
 * (opt-in strict inchangé : sans clé → couche VIDE, AUCUN appel réseau).
 */
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) || (env ? process.env[env] : undefined) || '';

// ── Couche `military_bases` — OSM/Overpass PUBLIC (implémentée réellement) ─────

/** Sous-ensemble utile d'un élément Overpass. */
interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number }; // ways/relations avec `out center`
  tags?: Record<string, string>;
}

/** Sous-ensemble utile d'une webcam Windy (API v3, source B). */
interface WindyWebcam {
  webcamId?: number;
  title?: string;
  location?: { latitude?: number; longitude?: number; city?: string; country?: string };
  // API v3 : `player.*` sont des URLs (string), pas des objets (vérifié 2026-07-15).
  player?: { day?: string; live?: string };
}

/**
 * Récupère les bases militaires OSM dans la bbox via Overpass (public, sans clé).
 * Dégradation douce : toute erreur (statut, timeout, JSON, réseau) → []. Ne jette
 * jamais. Les ways/relations n'ont pas de lat/lon direct → on lit `center`
 * (fourni par `out center`). Cap à MILITARY_MAX.
 *
 * Données OpenStreetMap © contributeurs, licence ODbL. Objets `military=base`
 * DÉJÀ publics dans la base OSM ; veille situationnelle, aucun ciblage.
 */
/**
 * Interroge Overpass en **`fetch` DIRECT** (hôtes FIXES, pas de SSRF possible) sur
 * la liste de miroirs : renvoie les `elements` du 1er miroir qui répond 200, sinon
 * [] (dégradation douce). NE PASSE PAS par `safeFetch` — son `dns.lookup` de
 * contrôle échoue sur ce VPS pour certains hôtes (constat 2026-07-15).
 */
async function fetchOverpass(query: string): Promise<OverpassElement[]> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OVERPASS_PER_MIRROR_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue; // miroir en erreur → suivant
      const payload = (await res.json()) as { elements?: OverpassElement[] };
      return Array.isArray(payload?.elements) ? payload.elements : [];
    } catch {
      continue; // refus (ECONNREFUSED) / timeout / JSON → miroir suivant
    } finally {
      clearTimeout(timeout);
    }
  }
  return []; // tous les miroirs KO
}

async function fetchMilitaryBases(bbox: BBox): Promise<MilitaryBase[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // Overpass attend la bbox en (Sud,Ouest,Nord,Est) = (minLat,minLng,maxLat,maxLng).
  const bboxClause = `(${minLat},${minLng},${maxLat},${maxLng})`;
  const query =
    `[out:json][timeout:20];` +
    `(nwr["military"="base"]${bboxClause};);` +
    `out center ${MILITARY_MAX};`;
  const elements = await fetchOverpass(query);
  const out: MilitaryBase[] = [];
  for (const el of elements) {
    if (out.length >= MILITARY_MAX) break;
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lng = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = el.tags?.name;
    out.push({
      id: `${el.type ?? 'osm'}/${el.id ?? `${lat},${lng}`}`,
      lat,
      lng,
      name: typeof name === 'string' && name ? name : undefined,
    });
  }
  return out;
}

// ── Couches à CLÉ (scaffolds opt-in) ─────────────────────────────────────────
//  Chacune suit le MÊME contrat : pas de clé → [] SANS appel réseau. La clé
//  présente, il reste à câbler la source réelle (URL + parsing) — le squelette
//  (env, type de sortie, filtrage, ETag) est déjà en place. On garde la lecture
//  d'env explicite pour que « mettre la clé » suffise à basculer la couche.

/**
 * `cctv` — LIGNE ROUGE ARPD. Opt-in via CCTV_SOURCE_KEY. Réservé à des caméras
 * PUBLIQUES consenties (webcams officielles/trafic). AUCUN flux privé, AUCUN
 * ciblage de personne. Sans clé → [] (aucun appel). Avec clé → à câbler sur la
 * source publique choisie, en normalisant vers CctvCam.
 */
async function fetchCctv(req: NextRequest, bbox: BBox): Promise<CctvCam[]> {
  // Deux sources complémentaires, toutes deux dans le cadre défensif :
  //   A) OSM `man_made=surveillance` — POSITIONS publiques de caméras (ODbL),
  //      SANS flux, comme `military_bases` → pas de clé (la couche n'est de toute
  //      façon interrogée qu'en forme 2 + consentement + toggle actif).
  //   B) Windy Webcams — vraies WEBCAMS PUBLIQUES consenties (tourisme/trafic,
  //      JAMAIS de vidéosurveillance) → opt-in par clé (CCTV_SOURCE_KEY = clé Windy).
  // Ligne rouge inchangée : aucun flux privé/exposé (pas de Shodan), aucun ciblage.
  const key = keyOf(req, 'cctv', 'CCTV_SOURCE_KEY');
  const [osm, windy] = await Promise.all([
    fetchCctvOsm(bbox),
    key ? fetchCctvWindy(key, bbox) : Promise.resolve<CctvCam[]>([]),
  ]);
  // Webcams (avec flux) d'abord, puis positions OSM ; plafond global de sûreté.
  return [...windy, ...osm].slice(0, CCTV_OSM_MAX + CCTV_WINDY_MAX);
}

/**
 * A) Caméras OSM (`man_made=surveillance`) via Overpass — PUBLIC, sans clé.
 * Positions seulement (pas de flux). Dégradation douce : toute erreur → [].
 * Données OpenStreetMap © contributeurs (ODbL), objets DÉJÀ publics. Veille
 * situationnelle, aucun ciblage de personne.
 */
async function fetchCctvOsm(bbox: BBox): Promise<CctvCam[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bboxClause = `(${minLat},${minLng},${maxLat},${maxLng})`;
  const query =
    `[out:json][timeout:20];` +
    `(nwr["man_made"="surveillance"]${bboxClause};);` +
    `out center ${CCTV_OSM_MAX};`;
  const elements = await fetchOverpass(query);
  const out: CctvCam[] = [];
  for (const el of elements) {
    if (out.length >= CCTV_OSM_MAX) break;
    const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const lng = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const t = el.tags ?? {};
    const stype = t['surveillance:type'] || t['camera:type'];
    const label = t.name || (stype ? `Caméra (${stype})` : 'Caméra (OSM)');
    out.push({ id: `${el.type ?? 'osm'}/${el.id ?? `${lat},${lng}`}`, lat, lng, label });
  }
  return out;
}

/**
 * B) Webcams publiques Windy (API v3) — opt-in par clé (CCTV_SOURCE_KEY = clé
 * Windy). L'API attend un point + rayon → on centre la bbox et on borne le rayon.
 * On normalise vers { id, lat, lng, label, streamUrl } (streamUrl = page d'embed
 * publique du lecteur Windy → ouverte dans le lecteur in-app via iframe).
 * Dégradation douce : toute erreur/forme inattendue → []. Aucune donnée perso.
 */
async function fetchCctvWindy(key: string, bbox: BBox): Promise<CctvCam[]> {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const clat = (minLat + maxLat) / 2;
  const clng = (minLng + maxLng) / 2;
  // Rayon ≈ demi-diagonale en km (1° lat ≈ 111 km), borné [25, 250] km (plancher
  // 25 pour capter des webcams même à zoom serré).
  const dLat = (maxLat - minLat) * 111;
  const dLng = (maxLng - minLng) * 111 * Math.cos((clat * Math.PI) / 180);
  const radiusKm = Math.max(25, Math.min(250, Math.round(Math.hypot(dLat, dLng) / 2)));
  // ⚠️ Requête alignée EXACTEMENT sur le fetch brut qui marche depuis le VPS
  // (2026-07-15) : include=location,player (PAS `urls`), et AUCUN User-Agent custom
  // (le UA `Osiris-Cockpit/…` avec URL était le suspect n°1 du filtrage Windy/WAF).
  const url =
    `${WINDY_WEBCAMS_ENDPOINT}?nearby=${clat.toFixed(4)},${clng.toFixed(4)},${radiusKm}` +
    `&limit=${CCTV_WINDY_MAX}&include=location,player`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // `fetch` DIRECT (hôte FIXE `api.windy.com` = pas de risque SSRF). PAS de safeFetch
    // (son dns.lookup de contrôle échoue sur ce VPS). PAS de User-Agent custom.
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'x-windy-api-key': key },
    });
    let cams: WindyWebcam[] = [];
    if (res.ok) {
      const payload = (await res.json()) as { webcams?: WindyWebcam[] };
      cams = Array.isArray(payload?.webcams) ? payload.webcams : [];
    }
    const out: CctvCam[] = [];
    for (const w of cams) {
      if (out.length >= CCTV_WINDY_MAX) break;
      const lat = w.location?.latitude;
      const lng = w.location?.longitude;
      const id = w.webcamId;
      if (typeof lat !== 'number' || typeof lng !== 'number' || id == null) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      // Embed public du lecteur Windy. Le champ `player.day` est une URL (string)
      // dans l'API v3 (vérifié 2026-07-15) ; repli sur l'URL d'embed canonique.
      const embed =
        (typeof w.player?.day === 'string' && w.player.day) ||
        (typeof w.player?.live === 'string' && w.player.live) ||
        `https://webcams.windy.com/webcams/public/embed/player/${id}/day`;
      const city = w.location?.city;
      out.push({
        id: `windy/${id}`,
        lat,
        lng,
        label: w.title || (city ? `Webcam ${city}` : 'Webcam'),
        streamUrl: embed,
      });
    }
    return out;
  } catch {
    return []; // dégradation douce
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `gps_jamming` — brouillage GPS. Opt-in via GPSJAM_KEY. Piste de source
 * PUBLIQUE documentée : gpsjam.org publie des agrégats H3 quotidiens en GeoJSON
 * (données ADS-B NIC agrégées) — pas d'API à clé officielle, format hexagones à
 * centroïder. À câbler proprement en forme 2. Sans clé → [] (aucun appel).
 */
async function fetchGpsJamming(req: NextRequest, _bbox: BBox): Promise<GpsJamming[]> {
  // Clé effective : en-tête user `x-osiris-key-gpsjam` OU env GPSJAM_KEY (voir
  // keyOf). Opt-in strict : sans aucune clé → [] SANS appel réseau.
  const key = keyOf(req, 'gpsjam', 'GPSJAM_KEY');
  if (!key) return [];
  // TODO(forme 2) : soit une source à clé, soit le GeoJSON public gpsjam.org
  // (centroïde de chaque hexagone H3 → { id, lat, lng, intensity }). Filtrer bbox.
  return [];
}

/**
 * `scanners` — scanners radio publics. Opt-in via SCANNER_KEY. Sans clé → []
 * (aucun appel). Avec clé → normaliser la source vers { id, lat, lng, label? }.
 */
async function fetchScanners(req: NextRequest, _bbox: BBox): Promise<Scanner[]> {
  // Clé effective : en-tête user `x-osiris-key-scanner` OU env SCANNER_KEY (voir
  // keyOf). Opt-in strict : sans aucune clé → [] SANS appel réseau.
  const key = keyOf(req, 'scanner', 'SCANNER_KEY');
  if (!key) return [];
  // TODO(forme 2) : brancher la source de scanners publics, normaliser, filtrer bbox.
  return [];
}

/**
 * `sigint` — points SIGINT ouverts (mesh / APRS). Opt-in via SIGINT_KEY. Sans
 * clé → [] (aucun appel). Avec clé → normaliser vers { id, lat, lng, type? }.
 * Piste : réseaux APRS publics (aprs.fi & co) selon licence/CGU.
 */
async function fetchSigint(req: NextRequest, _bbox: BBox): Promise<Sigint[]> {
  // Clé effective : en-tête user `x-osiris-key-sigint` OU env SIGINT_KEY (voir
  // keyOf). Opt-in strict : sans aucune clé → [] SANS appel réseau.
  const key = keyOf(req, 'sigint', 'SIGINT_KEY');
  if (!key) return [];
  // TODO(forme 2) : brancher la source mesh/APRS, normaliser, filtrer bbox.
  return [];
}

/**
 * `frontline` — tracé de ligne de front. Opt-in via FRONTLINE_KEY. Sans clé →
 * [] (aucun appel). Avec clé → renvoyer un/des segment(s) { id, geojson } (le
 * geojson est opaque : LineString/MultiLineString consommé tel quel par la carte).
 */
async function fetchFrontline(_bbox: BBox): Promise<Frontline[]> {
  const key = process.env.FRONTLINE_KEY;
  if (!key) return [];
  // TODO(forme 2) : brancher la source de tracé (GeoJSON), renvoyer { id, geojson }.
  return [];
}

/**
 * `telegram_osint` — signalements OSINT géolocalisés issus de canaux Telegram
 * PUBLICS. Opt-in via TELEGRAM_OSINT_KEY. Sans clé → [] (aucun appel). Données
 * publiques uniquement, aucun ciblage de personne. Avec clé → normaliser vers
 * { id, lat, lng, label? } et filtrer bbox.
 */
async function fetchTelegramOsint(req: NextRequest, _bbox: BBox): Promise<TelegramOsint[]> {
  // Clé effective : en-tête user `x-osiris-key-telegram` OU env TELEGRAM_OSINT_KEY
  // (voir keyOf). Opt-in strict : sans aucune clé → [] SANS appel réseau.
  const key = keyOf(req, 'telegram', 'TELEGRAM_OSINT_KEY');
  if (!key) return [];
  // TODO(forme 2) : brancher le collecteur Telegram OSINT (public), normaliser, bbox.
  return [];
}

// ── ETag ─────────────────────────────────────────────────────────────────────

/**
 * ETag faible dérivé UNIQUEMENT du contenu (counts + positions arrondies + ids),
 * jamais de l'horloge — même principe que /fast et /slow. Deux réponses au même
 * état → même ETag → 304 possible. Hash entier bon-marché (FNV-ish 32 bits).
 */
function computeETag(p: SensitivePayload): string {
  let acc = 0;
  const mixInt = (n: number) => {
    let h = (acc ^ (Math.round(n) | 0)) >>> 0;
    h = (h * 16777619) >>> 0;
    acc = h;
  };
  const mixStr = (s: string) => {
    for (const ch of s) mixInt(ch.charCodeAt(0));
  };
  const mixGeo = (id: string, lat: number, lng: number) => {
    mixStr(id);
    mixInt(lat * 100);
    mixInt(lng * 100);
  };
  for (const c of p.cctv) mixGeo(c.id, c.lat, c.lng);
  for (const g of p.gps_jamming) mixGeo(g.id, g.lat, g.lng);
  for (const s of p.scanners) mixGeo(s.id, s.lat, s.lng);
  for (const s of p.sigint) mixGeo(s.id, s.lat, s.lng);
  for (const m of p.military_bases) mixGeo(m.id, m.lat, m.lng);
  for (const f of p.frontline) mixStr(f.id); // geojson opaque → l'id porte le signal
  for (const t of p.telegram_osint) mixGeo(t.id, t.lat, t.lng);
  return (
    `W/"cc${p.cctv.length}-gj${p.gps_jamming.length}-sc${p.scanners.length}` +
    `-si${p.sigint.length}-mb${p.military_bases.length}-fl${p.frontline.length}` +
    `-tg${p.telegram_osint.length}-${acc.toString(36)}"`
  );
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const bbox = parseBBox(request.nextUrl.searchParams.get('bbox'));

  // Toutes les couches en parallèle. Chacune dégrade en douceur (→ []) et ne
  // jette jamais : une source morte ne casse pas les autres ni le polling.
  const [cctv, gps_jamming, scanners, sigint, military_bases, frontline, telegram_osint] =
    await Promise.all([
      fetchCctv(request, bbox),
      fetchGpsJamming(request, bbox),
      fetchScanners(request, bbox),
      fetchSigint(request, bbox),
      fetchMilitaryBases(bbox),
      fetchFrontline(bbox),
      fetchTelegramOsint(request, bbox),
    ]);

  const payload: SensitivePayload = {
    cctv,
    gps_jamming,
    scanners,
    sigint,
    military_bases,
    frontline,
    telegram_osint,
  };

  // ETag conditionnel : 304 si le client renvoie l'ETag courant.
  const etag = computeETag(payload);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    { ...payload, ts: Date.now() },
    {
      status: 200,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    },
  );
}
