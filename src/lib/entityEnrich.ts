// ─────────────────────────────────────────────────────────────────────────────
//  entityEnrich.ts — Enrichissement d'entité (photo + méta) · OSIRIS V4 · cockpit
//  Agent FICHES · V4.001
//
//  RÔLE
//  ────
//  Prend un avion normalisé (`AircraftPoint`, cf. OsirisMap) et l'enrichit pour
//  la carte-fiche <EntityCard> :
//    · une PHOTO de l'appareil via l'API publique gratuite planespotters.net ;
//    · les métadonnées VIP (nom, catégorie, liens sociaux) issues d'un seed local.
//
//  SOURCES & LÉGALITÉ
//  ──────────────────
//  Toutes les données sont PUBLIQUES et gratuites (usage défensif / ARPD) :
//    · planespotters.net — API photo publique, SANS clé, sans auth.
//      Endpoint : GET https://api.planespotters.net/pub/photos/hex/{hex}
//      Réponse : { photos: [{ thumbnail_large: { src }, link, photographer }, …] }
//      Conditions : usage non commercial, crédit photographe affiché (on le fait).
//    · adsb.lol — positions ADS-B publiques (déjà consommées côté carte).
//
//  CLEAN-ROOM : aucune ligne copiée d'un projet tiers. Implémentation maison.
//
//  CSP (next.config.ts) : déjà compatible en l'état —
//    · `connect-src ... https:` autorise le fetch vers api.planespotters.net ;
//    · `img-src 'self' data: blob: https:` autorise l'affichage des vignettes
//      servies depuis t.plnspttrs.net (domaine images de planespotters).
//  → Si la CSP était un jour durcie en liste blanche d'hôtes, il faudrait y
//    ajouter `api.planespotters.net` (connect-src) et `t.plnspttrs.net` (img-src).
// ─────────────────────────────────────────────────────────────────────────────

import type { AircraftPoint } from '@/components/OsirisMap';

// ── Photo d'appareil résolue depuis planespotters ────────────────────────────
export interface AircraftPhoto {
  /** URL de la vignette large (affichée dans la fiche). */
  thumbUrl: string;
  /** URL « large » si distincte (repli = thumbUrl). Utilisable en plein écran. */
  largeUrl: string;
  /** Nom du photographe (crédit obligatoire côté planespotters). */
  photographer: string;
  /** Lien vers la page photo planespotters (attribution + détail). */
  link: string;
}

// ── Lien social VIP (seed local, extensible) ─────────────────────────────────
export interface VipSocial {
  /** Libellé court affiché sur la puce (ex. « X », « Site »). */
  label: string;
  /** URL absolue cliquable. */
  url: string;
}

// ── Entité enrichie consommée par <EntityCard> ───────────────────────────────
export interface AircraftEnriched {
  // -- Identité / position (repris de AircraftPoint) --
  id: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  alt?: number;
  callsign?: string;
  hex?: string;
  category?: string;
  reg?: string;
  acType?: string;
  squawk?: string;
  emergency?: string;
  // -- Marqueur VIP (forme 2, données publiques) --
  vip?: boolean;
  vipName?: string;
  vipCategory?: string;
  vipColor?: string;
  // -- Enrichissements --
  /** Photo planespotters, ou null si aucune / échec (dégradation douce). */
  photo: AircraftPhoto | null;
  /** Route (départ → arrivée) résolue via adsbdb, ou null. */
  route: AircraftRoute | null;
  /** Liens sociaux VIP (seed), [] si non VIP ou inconnu. */
  socials: VipSocial[];
}

/** Aéroport d'un segment de route (adsbdb). */
export interface RouteAirport {
  iata?: string;
  icao?: string;
  name?: string;
  municipality?: string;
  country?: string;
}
/** Route d'un vol : origine → destination (adsbdb, gratuit sans clé). */
export interface AircraftRoute {
  origin: RouteAirport | null;
  destination: RouteAirport | null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cache mémoire des photos (par hex ICAO, minuscule).
//  On mémorise aussi les échecs (valeur null) pour ne pas re-taper l'API en
//  boucle sur un appareil sans photo. Cache volatile (durée de vie de l'onglet).
// ─────────────────────────────────────────────────────────────────────────────
const photoCache = new Map<string, AircraftPhoto | null>();

/** Délai max avant abandon de la requête photo (ms). */
const PHOTO_TIMEOUT_MS = 6000;

// Forme (partielle) de la réponse JSON planespotters — champs réellement lus.
interface PlanespottersPhotoRaw {
  thumbnail?: { src?: string };
  thumbnail_large?: { src?: string };
  link?: string;
  photographer?: string;
}
interface PlanespottersResponseRaw {
  photos?: PlanespottersPhotoRaw[];
}

/**
 * Récupère la photo d'un appareil par son hex ICAO via l'API publique gratuite
 * planespotters.net. Sans clé. Timeout ~6 s. Cache mémoire (succès ET échec).
 * Dégradation douce : renvoie `null` si rien trouvé, hex invalide, ou erreur.
 *
 * @param hex  Code hexadécimal ICAO 24 bits (ex. "3c6444"). Casse indifférente.
 */
export async function fetchAircraftPhoto(hex: string): Promise<AircraftPhoto | null> {
  // Garde-fou : hex vide/absent → pas d'appel réseau inutile.
  const key = (hex || '').trim().toLowerCase();
  if (!key) return null;

  // Cache (le null d'un précédent échec est volontairement mémorisé).
  if (photoCache.has(key)) return photoCache.get(key) ?? null;

  // Timeout via AbortController (l'API est publique et parfois lente).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(key)}`,
      { signal: controller.signal, headers: { Accept: 'application/json' } },
    );
    if (!res.ok) {
      photoCache.set(key, null);
      return null;
    }

    const json = (await res.json()) as PlanespottersResponseRaw;
    const first = json.photos?.[0];
    // Vignette large en priorité, repli sur la petite vignette.
    const thumb = first?.thumbnail_large?.src || first?.thumbnail?.src;
    if (!first || !thumb) {
      photoCache.set(key, null);
      return null;
    }

    const photo: AircraftPhoto = {
      thumbUrl: thumb,
      largeUrl: first.thumbnail_large?.src || thumb,
      photographer: first.photographer || 'Inconnu',
      link: first.link || 'https://www.planespotters.net/',
    };
    photoCache.set(key, photo);
    return photo;
  } catch {
    // Timeout, réseau coupé, JSON invalide… → dégradation douce.
    photoCache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SEED SOCIAL VIP (extensible)
//  Petit annuaire local nom VIP → liens publics officiels. Volontairement
//  minimal et documenté : on ajoute une entrée par VIP suivi si utile.
//  Clé = nom normalisé (minuscule, sans accent) pour un matching tolérant.
// ─────────────────────────────────────────────────────────────────────────────
const VIP_SOCIALS_SEED: Record<string, VipSocial[]> = {
  // Exemples de départ (liens publics officiels) — à enrichir au fil des besoins.
  'emmanuel macron': [
    { label: 'X', url: 'https://x.com/EmmanuelMacron' },
    { label: 'Élysée', url: 'https://www.elysee.fr/' },
  ],
  'elon musk': [
    { label: 'X', url: 'https://x.com/elonmusk' },
  ],
};

/** Normalise un nom pour la clé du seed (minuscule, sans accent, espaces réduits). */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // retire les diacritiques combinants
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Renvoie les liens sociaux publics d'un VIP depuis le seed local.
 * Renvoie [] si le nom est vide ou inconnu (dégradation douce, extensible).
 */
export function vipSocials(vipName?: string): VipSocial[] {
  if (!vipName) return [];
  return VIP_SOCIALS_SEED[normalizeName(vipName)] ?? [];
}

/**
 * Enrichit un avion (position + méta VIP) avec sa photo planespotters.
 * Combine la position brute, les champs VIP éventuels et la photo résolue.
 * Ne jette jamais : en cas d'échec photo, `photo` vaut null (fiche sans image).
 *
 * @param a  Avion normalisé issu de la carte (AircraftPoint).
 */
export async function enrichAircraft(a: AircraftPoint): Promise<AircraftEnriched> {
  // Photo (par hex) et route (par indicatif) résolues EN PARALLÈLE.
  const [photo, route] = await Promise.all([
    a.hex ? fetchAircraftPhoto(a.hex) : Promise.resolve(null),
    a.callsign ? fetchRoute(a.callsign) : Promise.resolve(null),
  ]);

  return {
    id: a.id,
    lat: a.lat,
    lng: a.lng,
    heading: a.heading,
    speed: a.speed,
    alt: a.alt,
    callsign: a.callsign,
    hex: a.hex,
    category: a.category,
    reg: a.reg,
    acType: a.acType,
    squawk: a.squawk,
    emergency: a.emergency,
    vip: a.vip,
    vipName: a.vipName,
    vipCategory: a.vipCategory,
    vipColor: a.vipColor,
    photo,
    route,
    socials: a.vip ? vipSocials(a.vipName) : [],
  };
}

// ── Route de vol (adsbdb.com — gratuit, sans clé, CORS ouvert) ───────────────
//  Traduit un indicatif de vol → aéroports d'origine et destination.
//  Cache mémoire (dont les échecs) pour ne pas retaper l'API en boucle.
const routeCache = new Map<string, AircraftRoute | null>();

function airportFrom(o: Record<string, unknown> | undefined): RouteAirport | null {
  if (!o || typeof o !== 'object') return null;
  const s = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
  return {
    iata: s('iata_code'),
    icao: s('icao_code'),
    name: s('name'),
    municipality: s('municipality'),
    country: s('country_iso_name'),
  };
}

async function fetchRoute(callsign: string): Promise<AircraftRoute | null> {
  const cs = callsign.trim().toUpperCase();
  if (!cs) return null;
  if (routeCache.has(cs)) return routeCache.get(cs) ?? null;
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      routeCache.set(cs, null); // 404 = indicatif inconnu (fréquent, normal)
      return null;
    }
    const json = (await res.json()) as {
      response?: { flightroute?: { origin?: Record<string, unknown>; destination?: Record<string, unknown> } };
    };
    const fr = json.response?.flightroute;
    if (!fr) {
      routeCache.set(cs, null);
      return null;
    }
    const route: AircraftRoute = {
      origin: airportFrom(fr.origin),
      destination: airportFrom(fr.destination),
    };
    routeCache.set(cs, route);
    return route;
  } catch {
    routeCache.set(cs, null);
    return null;
  }
}
