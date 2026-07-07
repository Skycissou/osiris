// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — LIVE DATA / FAST : couche « Aérien (temps réel) » + tag VIP.
//
//  Premier flux temps-réel du cockpit. Sert les avions ADS-B visibles dans le
//  viewport, à partir de données PUBLIQUES déjà diffusées (réseau adsb.lol,
//  API gratuite sans clé). Usage strictement VEILLE / situationnel défensif
//  (esprit ARPD) : uniquement ce que n'importe qui capte déjà sur 1090 MHz.
//
//  ── Enrichissement watchlist VIP (« couche sensible ») ──────────────────
//  On ajoute un simple TAG sur les avions dont le hex ICAO24 figure dans une
//  watchlist d'aéronefs DÉJÀ connus publiquement (type projets ouverts
//  « Plane-Alert » / bases d'enregistrement civiles). Cette couche sensible
//  relève de la FORME 2 (perso enquêteur, à discrétion de l'utilisateur) :
//  données publiques, aucun ciblage, aucune géoloc de personne — on se
//  contente d'annoter un identifiant d'appareil déjà diffusé sur le réseau.
//  Le SEED ci-dessous est volontairement minimal et extensible ; la vraie
//  base viendra branchée en forme 2 (voir WATCHLIST_VIP).
//
//  ── Couche « Navires (AIS) » ────────────────────────────────────────────
//  Second flux temps-réel de cette route : les navires diffusant leur position
//  en AIS. À la différence de l'ADS-B (adsb.lol, no-key), il n'existe PAS de
//  source AIS mondiale gratuite et sans clé fiable → cette couche NÉCESSITE une
//  clé. Elle reste donc VIDE par défaut (aucun appel réseau) tant que Cissou n'a
//  pas renseigné les variables d'env (voir bloc « AIS » plus bas). Objectif
//  « tout prêt, il ne reste qu'à mettre les clés à payer » : le scaffold est
//  complet (normalisation, filtre bbox, ETag, dégradation douce), il ne manque
//  que la source. Données PUBLIQUES (positions AIS déjà diffusées), veille
//  situationnelle défensive (esprit ARPD) : aucun ciblage de personne.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
//
//  Contrat côté client (voir src/lib/liveData.ts) :
//    GET /live-feed/fast?bbox=minLng,minLat,maxLng,maxLat
//    → 200 { aircraft, ships, count, ts }  + en-tête ETag (faible, stable)
//      • aircraft[] : chaque avion porte les champs vip / vipName / category /
//        vipColor (voir interface Aircraft). vip=false pour le tout-venant.
//      • ships[]    : navires AIS normalisés (voir interface Ship). [] si aucune
//        clé AIS configurée (défaut). `count` = nombre d'AVIONS (rétro-compat).
//    → 304 (corps vide) si If-None-Match == ETag courant (couvre avions + navires)
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
// (Timeout avions : voir TILE_FETCH_TIMEOUT_MS — le cache par tuile a remplacé
//  l'ancien FETCH_TIMEOUT_MS de 8 s, trop court pour le débit adsb.lol↔VPS.)
/** User-Agent identifiant l'appelant, exigé par l'étiquette adsb.lol. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

// ── Source AIS (couche « Navires ») — NÉCESSITE une clé ──────────────────────
//  ⚠️ VARIABLES D'ENV À RENSEIGNER (aucun appel réseau si absentes → ships:[]) :
//
//   • AISSTREAM_KEY   — clé aisstream.io (gratuite sur inscription).
//        ⚠️ IMPORTANT : aisstream.io est un flux WEBSOCKET (stream permanent),
//        PAS une API REST interrogeable par requête. On ne peut donc pas la
//        "poller" proprement depuis une route serverless appelée toutes les 15 s.
//        Pour exploiter aisstream.io il faut un petit pont WS→cache séparé (hors
//        périmètre de cette route). Renseigner AISSTREAM_KEY SEULE laissera donc
//        la couche vide (documenté) : il faut EN PLUS une source REST ci-dessous.
//
//   • AIS_REST_URL    — (recommandé) gabarit d'URL d'une source AIS REST
//        interrogeable à la demande (ex. offres REST type aisstream partenaires,
//        MarineTraffic, aishub, VesselFinder… selon l'abonnement de Cissou).
//        Placeholders remplacés à l'appel : {KEY} {MINLNG} {MINLAT} {MAXLNG}
//        {MAXLAT}. Ex. :
//        https://exemple-ais.tld/v1/vessels?key={KEY}&bbox={MINLNG},{MINLAT},{MAXLNG},{MAXLAT}
//   • AIS_REST_KEY    — (optionnel) clé de la source REST ci-dessus si elle
//        diffère d'AISSTREAM_KEY. À défaut on réutilise AISSTREAM_KEY pour {KEY}.
//
//  Règle d'or : SANS clé → aucun fetch, ships:[]. AVEC clé mais SANS AIS_REST_URL
//  → ships:[] (rien à poller). AVEC clé + AIS_REST_URL → on interroge la source
//  et on normalise. La route ne casse JAMAIS (dégradation douce → couche vide).
/** Timeout réseau vers la source AIS (ms). */
const AIS_FETCH_TIMEOUT_MS = 8_000;
/** Plafond de navires retenus (protège le client d'une réponse énorme). */
const AIS_MAX_SHIPS = 5000;

// ── Watchlist VIP (couche sensible — forme 2) ───────────────────────────────
/** Catégories VIP reconnues par le seed. Sert de clé au mapping couleur. */
type VipCategory = 'gouvernement' | 'dirigeant' | 'militaire';

/** Une entrée de watchlist : identité PUBLIQUE d'un aéronef déjà diffusée. */
interface VipEntry {
  name: string; // libellé lisible (public)
  category: VipCategory; // classe métier → couleur
}

/**
 * SEED de watchlist VIP, indexé par hex ICAO24 (minuscules).
 *
 * ⚠️ Nature : couche SENSIBLE relevant de la FORME 2 (perso enquêteur). Ce
 * seed est volontairement minimal (~7 aéronefs) et sert d'AMORCE de démo. La
 * vraie base — plus large et maintenue par l'utilisateur — viendra branchée
 * ailleurs (forme 2). On n'annote QUE des identifiants d'appareils déjà
 * publics, dans un esprit veille défensive (type projet ouvert « Plane-Alert »
 * / registres d'immatriculation civils). Aucune donnée de personne, aucun
 * ciblage : on pose juste un tag sur un hex déjà visible sur le réseau ADS-B.
 *
 * Les hex ci-dessous sont des identifiants publics documentés dans des bases
 * ouvertes ; à vérifier/étendre côté forme 2. Extensible : ajouter une ligne
 * suffit, le reste de la route s'adapte.
 */
const WATCHLIST_VIP: Record<string, VipEntry> = {
  adfeb3: { name: 'USAF VC-25A « Air Force One »', category: 'gouvernement' },
  ae1459: { name: 'USAF E-4B « Nightwatch »', category: 'militaire' },
  '43c6db': { name: 'RAF Voyager (transport gouvernemental UK)', category: 'gouvernement' },
  '3b7bXX': { name: 'FAF French Govt (exemple seed — à corriger)', category: 'gouvernement' },
  a835af: { name: 'Exécutif privé — dirigeant (exemple seed)', category: 'dirigeant' },
  '3c6544': { name: 'Luftwaffe A350 (transport gouvernemental DE)', category: 'gouvernement' },
  '400f00': { name: 'RAF / militaire UK (exemple seed)', category: 'militaire' },
};

/**
 * Couleurs de la charte V3 par catégorie VIP.
 *   gouvernement → accent  #54bdde
 *   dirigeant    → violet  #9a8cef
 *   militaire    → amber   #d6a445
 */
const VIP_COLORS: Record<VipCategory, string> = {
  gouvernement: '#54bdde',
  dirigeant: '#9a8cef',
  militaire: '#d6a445',
};

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
  category?: string; // catégorie ADS-B émetteur (A1..C7…) si diffusée — NE PAS confondre avec vipCategory
  // ── Champs d'enrichissement watchlist VIP (toujours présents) ──────────
  vip: boolean; // true si le hex figure dans WATCHLIST_VIP, false sinon
  vipName?: string; // libellé public de l'aéronef (ex. « Air Force One (VC-25) ») — seulement si vip
  /**
   * Catégorie VIP métier : 'gouvernement' | 'dirigeant' | 'militaire' (seed).
   * Nommée `vipCategory` — et NON `category` — pour ne pas écraser la catégorie
   * ADS-B émetteur ci-dessus, qui porte déjà une sémantique distincte.
   */
  vipCategory?: string;
  vipColor?: string; // couleur charte V3 dérivée de vipCategory — seulement si vip
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

/** Navire AIS normalisé, format compact consommé par la carte. */
interface Ship {
  id: string; // identifiant stable (= mmsi en string)
  lat: number;
  lng: number;
  heading?: number; // cap (deg) — COG ou true heading selon la source
  speed?: number; // vitesse sol (nœuds, SOG)
  name?: string; // nom du navire (public, tel que diffusé en AIS)
  type?: string; // type de navire (libellé ou code AIS, selon la source)
  mmsi: string; // Maritime Mobile Service Identity (identifiant AIS)
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Clé effective d'un service. Priorité à l'en-tête HTTP fourni par l'utilisateur
 * (`x-osiris-key-<service>`) — Cissou peut ainsi renseigner sa clé depuis l'app
 * sans redéployer — sinon repli sur la variable d'env. '' si ni l'un ni l'autre
 * (dégradation douce inchangée : la couche reste vide, jamais un 500).
 */
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) || (env ? process.env[env] : undefined) || '';

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

/**
 * Nb max de requêtes adsb.lol par tick — politesse envers la source gratuite.
 * (2×2 tuiles : couvre un continent en dézoom ; la vue monde reste partielle,
 * c'est la limite assumée du /v2/point à 250 NM.)
 */
const MAX_TILES = 4;

/**
 * Découpe la bbox en 1 ou 4 disques de requête (retour Cissou 07/07 : « les
 * avions sont toujours que sur la France et 1 état USA » en dézoom).
 * • bbox couverte par UN disque ≤ 250 NM → 1 requête (comportement historique) ;
 * • sinon → grille 2×2, chaque quadrant interrogé sur son propre disque
 *   circonscrit (plafonné) → couverture ×4, avions répartis sur toute la vue.
 */
function bboxToPoints(bbox: BBox): { lat: number; lng: number; radiusNm: number }[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  // Rayon NON plafonné qu'il faudrait pour couvrir la bbox d'un seul disque.
  const neededNm = haversineMeters(midLat, midLng, maxLat, maxLng) / NM_IN_METERS;
  if (neededNm <= MAX_RADIUS_NM) return [bboxToPoint(bbox)];
  const quadrants: BBox[] = [
    [minLng, minLat, midLng, midLat],
    [midLng, minLat, maxLng, midLat],
    [minLng, midLat, midLng, maxLat],
    [midLng, midLat, maxLng, maxLat],
  ];
  return quadrants.slice(0, MAX_TILES).map(bboxToPoint);
}

// ── Cache PAR TUILE + rafraîchissement en fond (anti-scintillement) ──────────
//  Diagnostic 07/07 (screenshot Cissou : avions qui clignotent, ronds qui
//  sautent, parfois en pleine mer) : le VPS télécharge adsb.lol LENTEMENT
//  (~300 Ko en 25 s mesuré) alors que le timeout était de 8 s et le polling de
//  15 s → quasi toutes les requêtes 250 NM expiraient, celles qui passaient
//  faisaient apparaître UN disque au hasard (centre d'un quadrant = parfois
//  l'océan), puis tout disparaissait au tick suivant.
//  Remède (même philosophie que gdeltGate) :
//    • réponse INSTANTANÉE depuis le cache par tuile (fraîche < 12 s, sinon
//      périmée < 2 min servie quand même) → affichage STABLE, jamais de trou ;
//    • UN SEUL téléchargement en cours par tuile (inflight), timeout 45 s,
//      qui remplit le cache en fond — le rythme réel s'adapte au débit amont.
const TILE_FRESH_MS = 12_000; // < cadence client (15 s) → au mieux 1 fetch/tuile/tick
const TILE_STALE_MAX_MS = 120_000; // au-delà : donnée trop vieille pour être montrée
const TILE_FETCH_TIMEOUT_MS = 45_000; // débit adsb.lol↔VPS lent : laisser finir

interface TileEntry {
  ts: number;
  ac: RawAircraft[];
}
const tileCache = new Map<string, TileEntry>();
const tileInflight = new Map<string, Promise<RawAircraft[] | null>>();

function tileKey(pt: { lat: number; lng: number; radiusNm: number }): string {
  return `${pt.lat.toFixed(2)},${pt.lng.toFixed(2)},${pt.radiusNm}`;
}

/** Téléchargement réel d'une tuile (une passe), met le cache à jour si OK. */
async function refreshTile(
  key: string,
  pt: { lat: number; lng: number; radiusNm: number },
): Promise<RawAircraft[] | null> {
  const upstream = `https://api.adsb.lol/v2/point/${pt.lat.toFixed(4)}/${pt.lng.toFixed(4)}/${pt.radiusNm}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TILE_FETCH_TIMEOUT_MS);
  try {
    // safeFetch : garde SSRF (valide l'hôte, re-valide chaque redirection).
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { ac?: RawAircraft[] };
    const ac = Array.isArray(payload.ac) ? payload.ac : [];
    tileCache.set(key, { ts: Date.now(), ac });
    return ac;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    tileInflight.delete(key);
  }
}

/**
 * Donnée d'une tuile : cache frais → direct ; cache périmé (< 2 min) → servi
 * immédiatement pendant qu'un refresh tourne en fond ; rien d'utilisable →
 * on attend le refresh (premier affichage). null = amont KO sans cache.
 */
async function fetchAdsbTile(pt: { lat: number; lng: number; radiusNm: number }): Promise<RawAircraft[] | null> {
  const key = tileKey(pt);
  const hit = tileCache.get(key);
  const age = hit ? Date.now() - hit.ts : Number.POSITIVE_INFINITY;
  if (hit && age < TILE_FRESH_MS) return hit.ac;
  if (!tileInflight.has(key)) tileInflight.set(key, refreshTile(key, pt));
  if (hit && age < TILE_STALE_MAX_MS) return hit.ac; // stable d'abord, frais ensuite
  return tileInflight.get(key)!;
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
    // Par défaut non-VIP : l'enrichissement watchlist (enrichVip) posera le tag
    // sur les seuls avions dont le hex matche WATCHLIST_VIP.
    vip: false,
  };
}

/**
 * Enrichit un avion SUR PLACE avec le tag watchlist VIP si son hex figure dans
 * WATCHLIST_VIP. Sinon laisse `vip: false` intact. Mutation volontaire (l'objet
 * vient d'être créé par normalize, il n'est pas partagé). Idempotent.
 */
function enrichVip(a: Aircraft): void {
  const entry = WATCHLIST_VIP[a.hex];
  if (!entry) return; // tout-venant : reste vip:false
  a.vip = true;
  a.vipName = entry.name;
  a.vipCategory = entry.category;
  a.vipColor = VIP_COLORS[entry.category];
}

// ── Helpers navires (AIS) ────────────────────────────────────────────────────

/**
 * Lit le premier champ NUMÉRIQUE trouvé parmi `keys` dans un objet brut (les
 * sources AIS diffèrent sur la casse/nommage : lat/latitude/LATITUDE, sog/speed…).
 * Accepte aussi les nombres encodés en string. Renvoie undefined si aucun.
 */
function firstNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Idem `firstNum` mais pour le premier champ chaîne non vide. */
function firstStr(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * Normalise un enregistrement AIS brut → Ship compact, en tolérant les
 * variantes de nommage courantes entre fournisseurs. Renvoie null si pas de
 * MMSI ni de position exploitable (rien à afficher sans lat/lng). AUCUNE
 * hypothèse de schéma : on pioche par liste d'alias, tout est optionnel.
 */
function normalizeShip(raw: unknown): Ship | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const lat = firstNum(o, ['lat', 'latitude', 'LATITUDE', 'Latitude', 'LAT', 'y']);
  const lng = firstNum(o, ['lng', 'lon', 'long', 'longitude', 'LONGITUDE', 'Longitude', 'LON', 'x']);
  if (lat === undefined || lng === undefined) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const mmsiNum = firstNum(o, ['mmsi', 'MMSI', 'UserID', 'userid']);
  const mmsiStr = firstStr(o, ['mmsi', 'MMSI', 'UserID', 'userid']);
  const mmsi = mmsiNum !== undefined ? String(Math.trunc(mmsiNum)) : (mmsiStr ?? '');
  if (!mmsi) return null; // pas d'identifiant AIS → on écarte

  const heading = firstNum(o, ['heading', 'Heading', 'trueHeading', 'TrueHeading', 'cog', 'COG', 'course', 'Cog']);
  const speed = firstNum(o, ['speed', 'sog', 'SOG', 'Sog', 'speedOverGround']);
  const name = firstStr(o, ['name', 'shipname', 'ShipName', 'Name', 'vesselName', 'VesselName']);
  const type = firstStr(o, ['type', 'shiptype', 'ShipType', 'Type', 'vesselType', 'shipTypeText']);

  return {
    id: mmsi,
    mmsi,
    lat,
    lng,
    heading: heading !== undefined ? heading : undefined,
    speed: speed !== undefined ? speed : undefined,
    name,
    type,
  };
}

/**
 * Extrait le tableau d'enregistrements AIS d'un payload JSON tolérant : soit un
 * tableau nu, soit un objet enveloppant sous une clé usuelle (vessels/ships/
 * data/results). Renvoie [] si rien d'exploitable.
 */
function extractShipArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    for (const k of ['vessels', 'ships', 'data', 'results', 'items', 'features']) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

/**
 * Récupère la couche navires (AIS). Contrat de dégradation douce :
 *   • pas de clé AIS                → []  (AUCUN appel réseau)
 *   • clé mais pas d'AIS_REST_URL   → []  (rien à poller — voir bloc AIS en tête)
 *   • clé + AIS_REST_URL            → fetch + normalisation + filtre bbox
 * Ne jette JAMAIS : toute erreur (statut, timeout, JSON, réseau) → couche vide.
 */
async function fetchShips(request: NextRequest, bbox: BBox): Promise<Ship[]> {
  // Clé AIS effective : en-tête user `x-osiris-key-ais_key` OU env AIS_REST_KEY
  // (voir keyOf), avec repli historique sur AISSTREAM_KEY.
  const key = keyOf(request, 'ais_key', 'AIS_REST_KEY') || process.env.AISSTREAM_KEY || '';
  // ⚠️ SÉCURITÉ (SSRF) : le GABARIT D'URL est lu UNIQUEMENT depuis l'env, JAMAIS
  //    depuis un en-tête de requête. Un en-tête est fourni par le client → le lire
  //    laisserait un attaquant choisir l'hôte cible (open-proxy + DNS-rebinding
  //    vers les services internes du VPS). La clé (identifiant) reste, elle,
  //    saisissable in-app car elle ne contrôle qu'un paramètre, pas l'hôte.
  const template = process.env.AIS_REST_URL || '';
  // Sans clé : on n'appelle rien (règle d'or). Sans gabarit REST non plus :
  // aisstream.io est un flux WebSocket, non pollable ici (voir en-tête AIS).
  if (!key || !template) return [];

  const [minLng, minLat, maxLng, maxLat] = bbox;
  const url = template
    .replace(/\{KEY\}/g, encodeURIComponent(key))
    .replace(/\{MINLNG\}/g, String(minLng))
    .replace(/\{MINLAT\}/g, String(minLat))
    .replace(/\{MAXLNG\}/g, String(maxLng))
    .replace(/\{MAXLAT\}/g, String(maxLat));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AIS_FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return []; // amont KO / rate-limit → couche vide
    const payload: unknown = await res.json();
    const rawList = extractShipArray(payload);
    const ships: Ship[] = [];
    for (const r of rawList) {
      if (ships.length >= AIS_MAX_SHIPS) break;
      const s = normalizeShip(r);
      // Filtre bbox : la source peut renvoyer plus large que l'emprise demandée.
      if (s && inBBox(s.lat, s.lng, bbox)) ships.push(s);
    }
    return ships;
  } catch {
    return []; // timeout / réseau / JSON invalide → dégradation douce
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ETag faible, stable et bon-marché : ne dépend QUE du contenu (avions +
 * navires : counts + positions arrondies + identifiants), jamais de l'horloge.
 * Deux réponses au même état renvoient le même ETag → 304 possible ; un
 * mouvement notable le change. Arrondi à ~0.01° (≈1 km) pour éviter un ETag qui
 * gigote au bruit GPS.
 */
function computeETag(list: Aircraft[], ships: Ship[]): string {
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
  for (const s of ships) {
    const latQ = Math.round(s.lat * 100);
    const lngQ = Math.round(s.lng * 100);
    let h = 2166136261;
    for (const ch of s.mmsi) h = (h ^ ch.charCodeAt(0)) * 16777619;
    h = (h ^ latQ) * 16777619;
    h = (h ^ lngQ) * 16777619;
    acc = (acc + (h >>> 0)) % 0x100000000;
  }
  return `W/"${list.length}s${ships.length}-${acc.toString(36)}"`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const bbox = parseBBox(request.nextUrl.searchParams.get('bbox'));

  // Couche NAVIRES (AIS) : indépendante des avions. Sans clé configurée elle
  // renvoie [] immédiatement (aucun fetch), donc zéro latence sur le cas démo.
  // Calculée d'abord pour être présente dans TOUTES les réponses, y compris les
  // dégradations avions ci-dessous.
  const ships = await fetchShips(request, bbox);

  // adsb.lol /v2/point — 1 disque (vue proche) ou grille 2×2 (dézoom), en
  // parallèle. Une tuile qui échoue est ignorée ; tout échoué → couche vide.
  const points = bboxToPoints(bbox);
  const tiles = await Promise.all(points.map((pt) => fetchAdsbTile(pt)));
  const okTiles = tiles.filter((t): t is RawAircraft[] => t !== null);
  if (okTiles.length === 0) {
    // Amont en panne / rate-limit : dégradation douce. Le client attend un
    // JSON mergeable ; on renvoie une couche vide plutôt que de casser le
    // polling. On la marque no-store et non conditionnable (pas d'ETag).
    return NextResponse.json(
      { aircraft: [], ships, count: 0, ts: Date.now(), error: 'amont adsb.lol indisponible' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Normalise + DÉDUPLIQUE par hex (les disques des tuiles se recouvrent) +
  // filtre sur la bbox RÉELLE (l'API renvoie des disques).
  const seen = new Set<string>();
  const aircraft: Aircraft[] = [];
  for (const raw of okTiles) {
    for (const r of raw) {
      const a = normalize(r);
      if (!a || !inBBox(a.lat, a.lng, bbox) || seen.has(a.hex)) continue;
      seen.add(a.hex);
      // Enrichissement watchlist VIP (forme 2) : pose le tag sur les seuls
      // hex connus ; les autres restent vip:false.
      enrichVip(a);
      aircraft.push(a);
    }
  }

  // ETag conditionnel : si le client renvoie le même → 304 sans corps.
  // Couvre avions ET navires (un mouvement de l'un ou l'autre change l'ETag).
  const etag = computeETag(aircraft, ships);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    // `count` reste le nombre d'AVIONS (rétro-compat) ; navires sous `ships`.
    { aircraft, ships, count: aircraft.length, ts: Date.now() },
    {
      status: 200,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    },
  );
}
