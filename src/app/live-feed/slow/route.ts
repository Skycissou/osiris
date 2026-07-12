// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — LIVE DATA / SLOW : couches géophysiques (flux « lent »).
//
//  Second flux du cockpit, poll toutes les 120 s côté client (voir
//  src/lib/liveData.ts). Agrège trois couches d'aléas naturels, à partir de
//  données PUBLIQUES ouvertes, pour un usage strictement VEILLE / situationnel
//  défensif (esprit ARPD). Aucune donnée personnelle : phénomènes naturels.
//
//  Six couches renvoyées (les CLÉS du body = noms de couches, exigé par
//  mergeData côté client) :
//    • earthquakes — séismes < 24 h, USGS (source RÉELLE, gratuite, sans clé).
//                    C'est la couche démo qui DOIT fonctionner hors-ligne de clé.
//    • wildfires   — feux actifs NASA FIRMS (NÉCESSITE une clé FIRMS_MAP_KEY ;
//                    absente → couche vide, la route ne casse pas).
//    • volcanoes   — pas d'API no-key fiable → [] + TODO documenté (voir plus bas).
//    • satellites  — positions SGP4 (temps réel) de satellites notables, TLE
//                    Celestrak PUBLICS et SANS clé. Source/calcul KO → [].
//                    Calcul délégué à src/lib/satellites.ts (fonctions pures).
//    • gdelt       — événements géopolitiques mondiaux < 24 h, API GDELT 2.0 GEO
//                    (GeoJSON, GRATUITE et SANS clé). Points chauds (manifs,
//                    conflits, élections…). Source KO → couche vide.
//    • cyber       — serveurs C2 malware actifs, abuse.ch Feodo Tracker (JSON,
//                    GRATUIT et SANS clé). CADRE STRICTEMENT DÉFENSIF : ce sont
//                    des INDICATEURS PUBLICS DE MENACE (veille cyber, blue-team),
//                    JAMAIS un outil d'exploitation offensive. Pas de lat/lng
//                    dans la source → géoloc par CENTROÏDE PAYS (table interne).
//                    Source KO → couche vide.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet. Calquée sur
//  le style de la route /fast (SSRF-guard safeFetch, ETag/304 dérivé du
//  contenu — jamais de Date.now dans l'ETag —, Cache-Control no-store,
//  dégradation douce : une source en panne renvoie une couche vide, jamais un
//  500 qui casserait le polling).
//
//  Contrat côté client :
//    GET /live-feed/slow[?bbox=minLng,minLat,maxLng,maxLat]
//    → 200 { earthquakes, wildfires, volcanoes, satellites, gdelt, cyber, ts }
//      + en-tête ETag
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
import { getGdeltEvents } from '@/lib/gdeltEvents';
import { getAcledEvents, acledConfigured } from '@/lib/acledEvents';
import { computeSatellites, SATS_SUIVIS, type SatPosition } from '@/lib/satellites';
import { recordCall } from '@/lib/telemetry';
import { ensureKeysLoaded, getServerKey } from '@/lib/serverKeyStore';

// Toujours dynamique : données temps quasi-réel, jamais de pré-rendu statique.
export const dynamic = 'force-dynamic';

// ── Constantes sources / réseau ─────────────────────────────────────────────
/** Flux USGS « tous séismes des dernières 24 h », GeoJSON, public sans clé. */
const USGS_ALL_DAY =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
/**
 * Endpoint NASA FIRMS « area CSV » monde, fenêtre 1 j. {KEY} = FIRMS_MAP_KEY,
 * {SENSOR} = capteur. Sans clé → on n'appelle même pas (couche vide).
 * MULTI-CAPTEURS (leçon 10/07) : le flux NRT d'un capteur peut être À SEC
 * (constaté : VIIRS S-NPP renvoyait 0 ligne, clé pourtant valide/quota 0). On
 * cumule NOAA-20 (le plus fiable) + S-NPP + MODIS → si l'un est vide, les autres
 * remplissent. Résultats fusionnés + dédupliqués par id (lat/lng/heure).
 */
const FIRMS_AREA_CSV_TMPL =
  'https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SENSOR}/world/1';
const FIRMS_SENSORS = ['VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT'];
/** Plafond de points feux retenus (protège le client d'un CSV énorme). */
const FIRMS_MAX_POINTS = 2000;
/**
 * Endpoint Celestrak « GP » (General Perturbations) au format TLE, PUBLIC et
 * SANS clé. {CATNR} = numéro de catalogue NORAD du satellite suivi. Renvoie 3
 * lignes (nom + 2 lignes TLE) par satellite. Doc : celestrak.org/NORAD/documentation.
 */
const CELESTRAK_GP_TMPL =
  'https://celestrak.org/NORAD/elements/gp.php?CATNR={CATNR}&FORMAT=tle';
/**
 * Endpoint Celestrak « GP » par GROUPE : UN seul appel ramène des centaines de
 * satellites (au lieu de 6 requêtes CATNR). Optimisation 07/07 : on interroge
 * les groupes « visual » (satellites brillants/visibles) + « stations »
 * (ISS/CSS…). {GROUP} url-encodé.
 */
const CELESTRAK_GROUP_TMPL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP={GROUP}&FORMAT=tle';
/** Groupes suivis (peu volumineux, sans clé). */
const CELESTRAK_GROUPS = ['visual', 'stations'] as const;
/** Plafond de satellites retenus (protège le client). */
const SAT_MAX_POINTS = 300;

// ── Cache TLE celestrak (fix 07/07 : celestrak RATE-LIMITE dur → « fetch failed »
//  en boucle depuis le VPS, diag 657 échecs/663). Les TLE sont valables PLUSIEURS
//  JOURS → on cache le blob 6 h (positions recalculées à chaque requête via SGP4,
//  seul le TLE est mis en cache) et on sert le stale jusqu'à 3 j en cas d'échec.
//  Résultat : celestrak appelé ~quelques fois/jour au lieu de centaines. ──────────
const TLE_TTL_MS = 6 * 60 * 60_000; // fraîcheur 6 h
const TLE_STALE_MAX_MS = 3 * 24 * 60 * 60_000; // stale servi jusqu'à 3 j
const G_TLE = globalThis as unknown as { __osirisTleCache?: { ts: number; blob: string } | null; __osirisTleInflight?: Promise<string> | null };
if (G_TLE.__osirisTleCache === undefined) G_TLE.__osirisTleCache = null;

/** Téléchargement réel du blob TLE (groupes, repli seed CATNR). Throw si vide. */
async function downloadTleBlob(): Promise<string> {
  const tleTexts = await Promise.all(
    CELESTRAK_GROUPS.map((g) =>
      fetchText(CELESTRAK_GROUP_TMPL.replace('{GROUP}', encodeURIComponent(g)), 'celestrak'),
    ),
  );
  let blob = tleTexts.filter((t): t is string => t !== null).join('\n');
  if (blob.trim().length === 0) {
    const seed = await Promise.all(
      SATS_SUIVIS.map((s) =>
        fetchText(CELESTRAK_GP_TMPL.replace('{CATNR}', encodeURIComponent(s.id)), 'celestrak'),
      ),
    );
    blob = seed.filter((t): t is string => t !== null).join('\n');
  }
  if (blob.trim().length === 0) throw new Error('celestrak vide');
  return blob;
}

/**
 * Blob TLE avec cache 6 h + stale-on-error 3 j + un seul téléchargement concurrent.
 * Renvoie '' seulement si aucun cache exploitable ET téléchargement KO.
 */
async function getTleBlob(): Promise<string> {
  const hit = G_TLE.__osirisTleCache;
  if (hit && Date.now() - hit.ts < TLE_TTL_MS) return hit.blob;
  if (!G_TLE.__osirisTleInflight) {
    G_TLE.__osirisTleInflight = downloadTleBlob()
      .then((blob) => {
        G_TLE.__osirisTleCache = { ts: Date.now(), blob };
        return blob;
      })
      .catch(() => '') // échec → on gère le stale ci-dessous
      .finally(() => {
        G_TLE.__osirisTleInflight = null;
      });
  }
  const fresh = await G_TLE.__osirisTleInflight;
  if (fresh) return fresh;
  // Téléchargement KO → stale borné (TLE dégradé mais exploitable quelques jours).
  if (hit && Date.now() - hit.ts < TLE_STALE_MAX_MS) return hit.blob;
  return '';
}
/**
 * API GDELT 2.0 GEO (« Geographic Query »), format GeoJSON, PUBLIQUE et SANS
 * clé. Renvoie une FeatureCollection de points géolocalisés agrégeant la
 * couverture média mondiale des dernières 24 h pour une requête donnée.
 * {QUERY} = requête thématique url-encodée (voir GDELT_QUERY ci-dessous).
 * Doc : https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/
 */
const GDELT_GEO_TMPL =
  'https://api.gdeltproject.org/api/v2/geo/geo?query={QUERY}&format=GeoJSON&timespan=24h';
/**
 * Requête GDELT par défaut : points chauds géopolitiques (manifestations,
 * conflits, attaques, troubles, élections). CONFIGURABLE — élargir/cibler ici
 * selon le besoin de veille (mots-clés, `domainis:`, `sourcelang:`, etc.).
 * Voir la doc GDELT DOC 2.0 pour la grammaire des requêtes.
 */
const GDELT_QUERY = '(protest OR conflict OR attack OR unrest OR election)';
/** Plafond de points GDELT retenus (protège le client d'une réponse volumineuse). */
const GDELT_MAX_POINTS = 300;
/**
 * abuse.ch Feodo Tracker — liste des serveurs C2 (Command-and-Control) de
 * botnets bancaires actifs, format JSON, GRATUIT et SANS clé. Chaque entrée :
 * { ip_address, port, country, malware, first_seen, last_online, … }.
 * USAGE STRICTEMENT DÉFENSIF (veille / blue-team / blocage) — indicateurs
 * publics de compromission, jamais d'exploitation offensive.
 * Doc : https://feodotracker.abuse.ch/blocklist/
 */
const FEODO_C2_JSON =
  'https://feodotracker.abuse.ch/downloads/ipblocklist.json';
/** Plafond de points cyber retenus. */
const CYBER_MAX_POINTS = 500;
/** Timeout réseau par source (ms). 10 s → 30 s le 07/07 : le CSV FIRMS monde
 *  (VIIRS world/1) est volumineux et le débit VPS↔sources peut être lent —
 *  10 s coupait le téléchargement → couche feux silencieusement vide. */
const FETCH_TIMEOUT_MS = 30_000;
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
  alert?: string; // PAGER (green/yellow/orange/red) — impact humain officiel
  tsunami?: boolean; // alerte tsunami possible
  sig?: number; // « significance » (0-1000) — importance globale
  type?: string; // earthquake / explosion / quarry blast (≠ séisme = signal !)
  magType?: string; // type de magnitude (mb, mw, ml…)
  url?: string; // fiche USGS (traçabilité/preuve)
}

/** Feu actif normalisé (FIRMS). */
interface Wildfire {
  id: string; // synthétique (lat/lng/time) — FIRMS ne fournit pas d'id stable
  lat: number;
  lng: number;
  bright: number | null; // température de brillance (K) — indicateur d'intensité
  time: string; // date+heure d'acquisition ('YYYY-MM-DD HH:MM')
  frp: number | null; // Fire Radiative Power (MW) — VRAIE puissance du feu
  confidence?: string; // fiabilité de la détection ('faible'/'nominale'/'haute' ou %)
  daynight?: string; // 'jour' | 'nuit'
  satellite?: string; // plateforme (S-NPP, NOAA-20…) — utile multi-capteurs
}

/** Volcan normalisé (structure PRÉVUE — couche vide pour l'instant, voir TODO). */
interface Volcano {
  id: string;
  lat: number;
  lng: number;
  name: string;
  status: string; // ex. état d'activité (« eruption », « unrest »…)
}

/** Événement géopolitique GDELT normalisé (point de couverture média agrégée). */
interface GdeltEvent {
  id: string; // synthétique (lat/lng[/name]) — GDELT ne fournit pas d'id stable
  lat: number;
  lng: number;
  name?: string; // libellé du lieu (properties.name)
  count?: number; // intensité = nb d'articles agrégés sur ce point (properties.count)
  title?: string; // titre/HTML d'exemple fourni par GDELT (properties.html/name)
  url?: string; // URL d'un article représentatif si disponible
  tone?: number; // tonalité moyenne GDELT (négatif = ton hostile), si présente
}

/**
 * Serveur C2 (Command-and-Control) normalisé — indicateur PUBLIC de menace.
 * Géolocalisé au CENTROÏDE de son pays (la source ne donne pas de coordonnées).
 * Cadre défensif : veille / blocage / cartographie de la menace, jamais offensif.
 */
interface CyberC2 {
  id: string; // ip (les IP C2 sont uniques dans la liste)
  lat: number;
  lng: number;
  ip: string; // adresse IPv4 du serveur C2
  malware?: string; // famille de malware associée (ex. « Emotet », « QakBot »)
  country?: string; // code pays ISO2 fourni par la source
  first_seen?: string; // date de première observation (chaîne source telle quelle)
  port?: number; // port du C2 (IOC actionnable)
  status?: string; // online / offline
  asn?: number; // ASN hébergeur
  asName?: string; // nom hébergeur
  hostname?: string; // nom d'hôte du C2
  lastOnline?: string; // dernière activité observée
}

// ── Types bruts USGS (sous-ensemble utile) ──────────────────────────────────
interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    alert?: string | null; // niveau PAGER (green/yellow/orange/red)
    tsunami?: number | null; // 1 = alerte tsunami possible
    sig?: number | null; // « significance » 0-1000
    type?: string | null; // earthquake / explosion / quarry blast…
    magType?: string | null; // mb, mw, ml…
    url?: string | null; // fiche USGS
  };
  geometry?: { coordinates?: [number, number, number] }; // [lng, lat, depth]
}
interface UsgsFeed {
  features?: UsgsFeature[];
}

// ── Types bruts GDELT GeoJSON (sous-ensemble utile) ──────────────────────────
//  GDELT GEO 2.0 renvoie une FeatureCollection classique. Les propriétés
//  exactes varient selon le mode ; on lit défensivement les clés courantes
//  (name/count/html/url/tone) et on ignore le reste.
interface GdeltFeature {
  geometry?: { type?: string; coordinates?: [number, number] }; // [lng, lat]
  properties?: {
    name?: string | null;
    count?: number | string | null;
    html?: string | null;
    shareimage?: string | null;
    url?: string | null;
    tone?: number | string | null;
  };
}
interface GdeltCollection {
  features?: GdeltFeature[];
}

// ── Types bruts Feodo Tracker (sous-ensemble utile) ──────────────────────────
interface FeodoEntry {
  ip_address?: string | null;
  country?: string | null;
  malware?: string | null;
  first_seen?: string | null;
  port?: number | null; // port du C2 — IOC actionnable (blocage)
  status?: string | null; // online / offline
  as_number?: number | null; // ASN hébergeur
  as_name?: string | null; // nom hébergeur (bulletproof récurrents)
  hostname?: string | null; // nom d'hôte du C2 (pivot domaine)
  last_online?: string | null; // dernière activité
}

// ── Table de centroïdes pays (ISO2 → {lat,lng}) ──────────────────────────────
//  La source Feodo ne fournit PAS de coordonnées, seulement un code pays ISO2.
//  On géolocalise chaque C2 au centroïde APPROXIMATIF de son pays (précision
//  volontairement grossière : c'est une carte de MENACE agrégée, pas du
//  ciblage). Couverture : ~45 pays les plus fréquents dans les feeds C2 ;
//  un pays absent de la table → le point est simplement OMIS (dégradation
//  douce, jamais d'erreur). Valeurs = centroïdes géographiques usuels (approx).
const COUNTRY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  US: { lat: 39.8, lng: -98.6 }, // États-Unis
  CA: { lat: 56.1, lng: -106.3 }, // Canada
  BR: { lat: -14.2, lng: -51.9 }, // Brésil
  MX: { lat: 23.6, lng: -102.5 }, // Mexique
  AR: { lat: -38.4, lng: -63.6 }, // Argentine
  GB: { lat: 55.4, lng: -3.4 }, // Royaume-Uni
  IE: { lat: 53.4, lng: -8.2 }, // Irlande
  FR: { lat: 46.2, lng: 2.2 }, // France
  DE: { lat: 51.2, lng: 10.4 }, // Allemagne
  NL: { lat: 52.1, lng: 5.3 }, // Pays-Bas
  BE: { lat: 50.5, lng: 4.5 }, // Belgique
  LU: { lat: 49.8, lng: 6.1 }, // Luxembourg
  ES: { lat: 40.5, lng: -3.7 }, // Espagne
  PT: { lat: 39.4, lng: -8.2 }, // Portugal
  IT: { lat: 41.9, lng: 12.6 }, // Italie
  CH: { lat: 46.8, lng: 8.2 }, // Suisse
  AT: { lat: 47.5, lng: 14.6 }, // Autriche
  SE: { lat: 60.1, lng: 18.6 }, // Suède
  NO: { lat: 60.5, lng: 8.5 }, // Norvège
  FI: { lat: 61.9, lng: 25.7 }, // Finlande
  DK: { lat: 56.3, lng: 9.5 }, // Danemark
  PL: { lat: 51.9, lng: 19.1 }, // Pologne
  CZ: { lat: 49.8, lng: 15.5 }, // Tchéquie
  SK: { lat: 48.7, lng: 19.7 }, // Slovaquie
  HU: { lat: 47.2, lng: 19.5 }, // Hongrie
  RO: { lat: 45.9, lng: 24.9 }, // Roumanie
  BG: { lat: 42.7, lng: 25.5 }, // Bulgarie
  GR: { lat: 39.1, lng: 21.8 }, // Grèce
  UA: { lat: 48.4, lng: 31.2 }, // Ukraine
  RU: { lat: 61.5, lng: 105.3 }, // Russie
  TR: { lat: 38.9, lng: 35.2 }, // Turquie
  IL: { lat: 31.0, lng: 34.9 }, // Israël
  SA: { lat: 23.9, lng: 45.1 }, // Arabie saoudite
  AE: { lat: 23.4, lng: 53.8 }, // Émirats arabes unis
  IR: { lat: 32.4, lng: 53.7 }, // Iran
  IN: { lat: 22.0, lng: 79.0 }, // Inde
  PK: { lat: 30.4, lng: 69.3 }, // Pakistan
  CN: { lat: 35.9, lng: 104.2 }, // Chine
  HK: { lat: 22.3, lng: 114.2 }, // Hong Kong
  TW: { lat: 23.7, lng: 121.0 }, // Taïwan
  JP: { lat: 36.2, lng: 138.3 }, // Japon
  KR: { lat: 35.9, lng: 127.8 }, // Corée du Sud
  SG: { lat: 1.35, lng: 103.8 }, // Singapour
  ID: { lat: -0.8, lng: 113.9 }, // Indonésie
  TH: { lat: 15.9, lng: 100.99 }, // Thaïlande
  VN: { lat: 14.1, lng: 108.3 }, // Viêt Nam
  MY: { lat: 4.2, lng: 101.98 }, // Malaisie
  AU: { lat: -25.3, lng: 133.8 }, // Australie
  NZ: { lat: -40.9, lng: 174.9 }, // Nouvelle-Zélande
  ZA: { lat: -30.6, lng: 22.9 }, // Afrique du Sud
  EG: { lat: 26.8, lng: 30.8 }, // Égypte
  NG: { lat: 9.1, lng: 8.7 }, // Nigéria
};

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
// Priorité : en-tête navigateur (clé perso) → COFFRE serveur (page admin, clés
// « couches ») → env. Le coffre permet à un vrai utilisateur d'avoir les couches
// sans SSH (retour Cissou 07/07). ensureKeysLoaded() est appelé dans le handler.
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) ||
  getServerKey(service) ||
  (env ? process.env[env] : undefined) ||
  '';

async function fetchText(url: string, source?: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (source) recordCall({ source, ok: res.ok, status: res.status, ms: Date.now() - started });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    if (source) recordCall({ source, ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
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
    const alert = typeof p.alert === 'string' && p.alert ? p.alert.toLowerCase() : undefined;
    const type = typeof p.type === 'string' && p.type ? p.type : undefined;
    out.push({
      id: typeof f.id === 'string' && f.id ? f.id : `${lat},${lng},${p.time ?? ''}`,
      lat,
      lng,
      mag: typeof p.mag === 'number' && Number.isFinite(p.mag) ? p.mag : null,
      depth: typeof depth === 'number' && Number.isFinite(depth) ? depth : null,
      place: typeof p.place === 'string' ? p.place : '',
      time: typeof p.time === 'number' && Number.isFinite(p.time) ? p.time : 0,
      alert,
      tsunami: p.tsunami === 1 ? true : undefined,
      sig: typeof p.sig === 'number' && Number.isFinite(p.sig) ? p.sig : undefined,
      type,
      magType: typeof p.magType === 'string' && p.magType ? p.magType : undefined,
      url: typeof p.url === 'string' && p.url ? p.url : undefined,
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
  // Colonnes d'ENRICHISSEMENT (audit 07/07 : elles étaient jetées → 1 point muet).
  const iFrp = header.indexOf('frp'); // Fire Radiative Power (MW) — puissance réelle
  const iConf = header.indexOf('confidence'); // VIIRS: l/n/h · MODIS: 0-100
  const iDayNight = header.indexOf('daynight'); // D/N
  const iSat = header.indexOf('satellite'); // N / NOAA-20 / 1…
  if (iLat === -1 || iLng === -1) {
    // Format inattendu = souvent un MESSAGE FIRMS en HTTP 200 (clé invalide,
    // quota). Avant le 07/07 c'était 100 % silencieux → intraçable. On loggue
    // le début du texte pour que `docker logs osiris-v4-cockpit` dise pourquoi.
    console.warn('[OSIRIS feux] réponse FIRMS non-CSV (clé invalide/quota ?):', text.trim().slice(0, 160));
    return []; // couche vide (dégradation douce)
  }

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
    const frp = iFrp !== -1 ? Number(cols[iFrp]) : NaN;
    out.push({
      id: `${lat},${lng},${time}`,
      lat,
      lng,
      bright: Number.isFinite(bright) ? bright : null,
      time,
      frp: Number.isFinite(frp) ? Math.round(frp * 10) / 10 : null,
      confidence: iConf !== -1 ? normFireConfidence(cols[iConf]) : undefined,
      daynight: iDayNight !== -1 ? normDayNight(cols[iDayNight]) : undefined,
      satellite: iSat !== -1 ? (cols[iSat] ?? '').trim() || undefined : undefined,
    });
  }
  return out;
}

/** Normalise la confiance FIRMS : VIIRS = l/n/h · MODIS = 0-100 (%). */
function normFireConfidence(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'l' || s === 'low') return 'faible';
  if (s === 'n' || s === 'nominal') return 'nominale';
  if (s === 'h' || s === 'high') return 'haute';
  const n = Number(s);
  return Number.isFinite(n) ? `${n}%` : undefined;
}

/** Normalise le drapeau jour/nuit FIRMS ('D'/'N'). */
function normDayNight(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === 'D') return 'jour';
  if (s === 'N') return 'nuit';
  return undefined;
}

/**
 * Normalise la FeatureCollection GDELT GEO → GdeltEvent[]. Coordonnées depuis
 * geometry.coordinates ([lng, lat] — ordre GeoJSON) ; libellé/intensité/URL
 * depuis properties (lecture défensive : count peut arriver en string, tone
 * idem). Ignore toute feature sans point exploitable. Plafonne à
 * GDELT_MAX_POINTS. Dégradation douce : JSON invalide → couche vide.
 */
function parseGdelt(text: string): GdeltEvent[] {
  let coll: GdeltCollection;
  try {
    coll = JSON.parse(text) as GdeltCollection;
  } catch {
    return []; // JSON invalide → couche vide (dégradation douce)
  }
  const features = Array.isArray(coll.features) ? coll.features : [];
  const out: GdeltEvent[] = [];
  for (const f of features) {
    if (out.length >= GDELT_MAX_POINTS) break;
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const p = f.properties ?? {};
    // count : GDELT le fournit tantôt en nombre, tantôt en chaîne.
    const countNum = typeof p.count === 'number' ? p.count : Number(p.count);
    const toneNum = typeof p.tone === 'number' ? p.tone : Number(p.tone);
    const name = typeof p.name === 'string' && p.name ? p.name : undefined;
    out.push({
      id: `${lat.toFixed(4)},${lng.toFixed(4)}${name ? `,${name}` : ''}`,
      lat,
      lng,
      ...(name ? { name } : {}),
      ...(Number.isFinite(countNum) ? { count: countNum } : {}),
      // GDELT met souvent un extrait HTML dans properties.html : on l'expose
      // comme titre indicatif (le câblage carte décidera de l'assainir/tronquer).
      ...(typeof p.html === 'string' && p.html ? { title: p.html } : {}),
      ...(typeof p.url === 'string' && p.url ? { url: p.url } : {}),
      ...(Number.isFinite(toneNum) ? { tone: toneNum } : {}),
    });
  }
  return out;
}

/**
 * Normalise le blocklist JSON Feodo Tracker → CyberC2[]. La source ne donne pas
 * de coordonnées : on géolocalise chaque C2 au centroïde de son pays (table
 * COUNTRY_CENTROIDS). Un pays absent de la table OU une entrée sans IP → OMIS
 * (dégradation douce). Déduplique par IP. Plafonne à CYBER_MAX_POINTS.
 * Dégradation douce : JSON invalide/non-tableau → couche vide.
 */
function parseFeodo(text: string): CyberC2[] {
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    return []; // JSON invalide → couche vide
  }
  if (!Array.isArray(rows)) return []; // format inattendu → couche vide
  const out: CyberC2[] = [];
  const seen = new Set<string>();
  for (const raw of rows as FeodoEntry[]) {
    if (out.length >= CYBER_MAX_POINTS) break;
    const ip = typeof raw?.ip_address === 'string' ? raw.ip_address.trim() : '';
    if (!ip || seen.has(ip)) continue;
    const cc = typeof raw?.country === 'string' ? raw.country.trim().toUpperCase() : '';
    const centroid = cc ? COUNTRY_CENTROIDS[cc] : undefined;
    if (!centroid) continue; // pas de pays connu → on omet le point
    seen.add(ip);
    out.push({
      id: ip,
      lat: centroid.lat,
      lng: centroid.lng,
      ip,
      ...(typeof raw.malware === 'string' && raw.malware ? { malware: raw.malware } : {}),
      ...(cc ? { country: cc } : {}),
      ...(typeof raw.first_seen === 'string' && raw.first_seen
        ? { first_seen: raw.first_seen }
        : {}),
      ...(typeof raw.port === 'number' && Number.isFinite(raw.port) ? { port: raw.port } : {}),
      ...(typeof raw.status === 'string' && raw.status ? { status: raw.status } : {}),
      ...(typeof raw.as_number === 'number' && Number.isFinite(raw.as_number) ? { asn: raw.as_number } : {}),
      ...(typeof raw.as_name === 'string' && raw.as_name ? { asName: raw.as_name } : {}),
      ...(typeof raw.hostname === 'string' && raw.hostname ? { hostname: raw.hostname } : {}),
      ...(typeof raw.last_online === 'string' && raw.last_online ? { lastOnline: raw.last_online } : {}),
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
  gd: GdeltEvent[],
  cy: CyberC2[],
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
  for (const g of gd) {
    mix(g.lat * 100);
    mix(g.lng * 100);
    mix(g.count ?? 0);
  }
  for (const c of cy) {
    mix(c.lat * 100);
    mix(c.lng * 100);
    // L'IP différencie deux C2 partageant le même centroïde pays : on replie
    // un hash simple de la chaîne pour que l'ETag reflète la composition réelle.
    let iph = 0;
    for (let k = 0; k < c.ip.length; k++) iph = (iph * 31 + c.ip.charCodeAt(k)) >>> 0;
    mix(iph % 1000000);
  }
  return `W/"eq${eq.length}-wf${wf.length}-vo${vo.length}-sa${sa.length}-gd${gd.length}-cy${cy.length}-${acc.toString(36)}"`;
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // On lit le param bbox pour ne pas planter s'il est fourni, mais on ne
  // l'exploite pas (couches globales/nationales — voir en-tête du fichier).
  void request.nextUrl.searchParams.get('bbox');

  // Coffre serveur chargé → keyOf peut lire les clés « couches » (FIRMS) saisies
  // par l'admin dans l'app, sans SSH ni .env (retour Cissou 07/07).
  await ensureKeysLoaded();

  // ── 1) SÉISMES — USGS (source réelle, la couche démo qui doit marcher) ────
  const usgsText = await fetchText(USGS_ALL_DAY, 'USGS');
  const earthquakes: Earthquake[] = usgsText ? parseUsgs(usgsText) : [];

  // ── 2) FEUX — NASA FIRMS (nécessite FIRMS_MAP_KEY, sinon couche vide) ─────
  //  Clé gratuite : https://firms.modaps.eosdis.nasa.gov/api/map_key/
  //  Absente → on n'appelle PAS l'API et on renvoie []. La route ne casse pas.
  let wildfires: Wildfire[] = [];
  // Clé effective : en-tête user `x-osiris-key-firms` OU env FIRMS_MAP_KEY (voir
  // keyOf). Absente → on n'appelle PAS l'API, couche wildfires vide.
  const firmsKey = keyOf(request, 'firms', 'FIRMS_MAP_KEY');
  if (firmsKey) {
    const encKey = encodeURIComponent(firmsKey);
    // Les capteurs sont interrogés EN PARALLÈLE (latence = le plus lent, pas la
    // somme), puis fusionnés + dédupliqués. Un capteur à sec renvoie juste 0 ligne.
    const texts = await Promise.all(
      FIRMS_SENSORS.map((sensor) => fetchText(FIRMS_AREA_CSV_TMPL.replace('{KEY}', encKey).replace('{SENSOR}', sensor), 'FIRMS')),
    );
    const seen = new Set<string>();
    for (const text of texts) {
      if (!text) continue;
      for (const w of parseFirmsCsv(text)) {
        if (seen.has(w.id)) continue;
        seen.add(w.id);
        wildfires.push(w);
        if (wildfires.length >= FIRMS_MAX_POINTS) break;
      }
      if (wildfires.length >= FIRMS_MAX_POINTS) break;
    }
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
    // TLE via cache 6 h + stale 3 j (fini le martelage de celestrak, fix 07/07).
    // Positions RECALCULÉES à chaque requête (SGP4, instant unique) depuis le blob
    // caché → mouvement live conservé sans re-télécharger.
    const blob = await getTleBlob();
    if (blob.trim().length > 0) {
      satellites = computeSatellites(blob, new Date()).slice(0, SAT_MAX_POINTS);
    }
  } catch {
    satellites = []; // toute erreur inattendue → couche vide, la route tient
  }

  // ── 5) GÉOPOLITIQUE — GDELT 2.0 GEO (GeoJSON, gratuit, sans clé) ──────────
  //  Points chauds média mondiaux < 24 h pour GDELT_QUERY (configurable en tête
  //  de fichier). Source KO / JSON invalide → couche vide, la route tient.
  //  ⚠️ SOURCE CHANGÉE le 07/07 (V4.020, GO Cissou) : l'API GEO interactive de
  //  GDELT renvoie un vrai 404 (morte/retirée — la couche n'a jamais affiché).
  //  → FICHIERS export 15-min de data.gdeltproject.org via lib/gdeltEvents
  //  (cache 15 min + stale-on-error, même forme GdeltEvent — carte inchangée).
  //  L'ancien chemin (GDELT_GEO_TMPL/GDELT_QUERY/parseGdelt) reste archivé ici.
  //  GÉOPO : ACLED (conflits armés, clé) en PRIORITÉ — GDELT étant bloqué depuis
  //  l'IP du VPS. Sans clé ACLED → on retombe sur GDELT (souvent vide côté VPS).
  const gdelt: GdeltEvent[] = acledConfigured()
    ? await getAcledEvents().catch(() => [])
    : await getGdeltEvents().catch(() => []);

  // ── 6) CYBER — abuse.ch Feodo Tracker (JSON, gratuit, sans clé) ───────────
  //  CADRE DÉFENSIF : indicateurs PUBLICS de menace (serveurs C2 de botnets),
  //  destinés à la veille / au blocage / à la cartographie de la menace — JAMAIS
  //  à une exploitation offensive. Pas de coordonnées dans la source → géoloc
  //  par centroïde pays (COUNTRY_CENTROIDS). Source KO → couche vide.
  const feodoText = await fetchText(FEODO_C2_JSON, 'abuse.ch');
  const cyber: CyberC2[] = feodoText ? parseFeodo(feodoText) : [];

  // ── ETag conditionnel : 304 si le client renvoie l'ETag courant ───────────
  const etag = computeETag(earthquakes, wildfires, volcanoes, satellites, gdelt, cyber);
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    { earthquakes, wildfires, volcanoes, satellites, gdelt, cyber, ts: Date.now() },
    {
      status: 200,
      headers: {
        ETag: etag,
        'Cache-Control': 'no-store',
      },
    },
  );
}
