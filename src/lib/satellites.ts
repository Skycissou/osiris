// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — SATELLITES : propagation d'orbites SGP4 depuis des TLE publics.
//
//  RÔLE
//    Transforme des jeux d'éléments à deux lignes (TLE — Two-Line Element sets,
//    format NORAD) en positions géodésiques instantanées { id, name, lat, lng,
//    alt } prêtes à afficher sur la carte du cockpit. Le calcul repose sur le
//    modèle SGP4 (Simplified General Perturbations 4) via la lib `satellite.js`
//    (pure Node, aucun réseau, aucun binaire natif requis → OK côté route
//    serveur Next).
//
//  SOURCE DES TLE
//    Celestrak (https://celestrak.org) — données PUBLIQUES, gratuites, SANS clé.
//    Ce fichier NE fait AUCUN fetch : il reçoit le texte TLE déjà récupéré (par
//    la route /live-feed/slow, derrière le SSRF-guard) et se contente de le
//    parser + propager. Fonctions PURES et testables → séparation nette
//    « I/O réseau » (route) vs « calcul orbital » (ici).
//
//  PIPELINE DE CALCUL (par satellite)
//    TLE (2 lignes) ──twoline2satrec──▶ satrec
//    satrec + date  ──propagate───────▶ position ECI (km) [Earth-Centered Inertial]
//    date           ──gstime──────────▶ GMST (temps sidéral de Greenwich)
//    ECI + GMST     ──eciToGeodetic───▶ { latitude, longitude (rad), height (km) }
//    rad ──degreesLat/degreesLong──────▶ lat/lng en degrés (lng wrap [-180,180))
//
//  DÉGRADATION DOUCE
//    TLE illisible / satrec en erreur / propagation nulle → le satellite est
//    IGNORÉ (jamais d'exception qui remonterait casser le flux global). La
//    route décide quoi faire d'un tableau vide.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';

// ── Contrat de sortie (item consommé par la carte) ──────────────────────────
/**
 * Position instantanée d'un satellite, forme compacte alignée sur les autres
 * couches du cockpit (cf. Earthquake/Wildfire dans /live-feed/slow).
 */
export interface SatPosition {
  /** Numéro NORAD (catalogue) sous forme de chaîne — id STABLE, extrait du TLE. */
  id: string;
  /** Nom lisible (ligne 0 du TLE, ex. « ISS (ZARYA) »). */
  name: string;
  /** Latitude géodésique en degrés, [-90, 90]. */
  lat: number;
  /** Longitude géodésique en degrés, wrap [-180, 180). */
  lng: number;
  /** Altitude au-dessus de l'ellipsoïde en kilomètres. */
  alt: number;
}

// ── Seed de satellites suivis ───────────────────────────────────────────────
/**
 * Petite liste de satellites notables à suivre par défaut. C'est un SEED
 * EXTENSIBLE : ajouter une entrée { id: '<NORAD>', name: '<libellé>' } suffit,
 * la route ira chercher son TLE chez Celestrak par numéro de catalogue.
 * Le `name` ici n'est qu'un libellé de repli/documentation : à l'exécution, le
 * nom réel provient de la ligne 0 du TLE Celestrak (source de vérité).
 *
 * Choix du seed : objets grand public, orbites basses (LEO) bien visibles.
 *   • 25544 — ISS (ZARYA)        : station spatiale internationale
 *   • 20580 — HST (Hubble)       : télescope spatial
 *   • 25994 — Terra (EOS AM-1)   : observation de la Terre (NASA)
 *   • 39084 — Landsat 8          : imagerie/observation
 *   • 43013 — NOAA 20 (JPSS-1)   : météo/observation
 *   • 44714 — Starlink-1007      : exemple de méga-constellation (LEO)
 */
export const SATS_SUIVIS: ReadonlyArray<{ id: string; name: string }> = [
  { id: '25544', name: 'ISS (ZARYA)' },
  { id: '20580', name: 'HST (Hubble)' },
  { id: '25994', name: 'Terra (EOS AM-1)' },
  { id: '39084', name: 'Landsat 8' },
  { id: '43013', name: 'NOAA 20 (JPSS-1)' },
  { id: '44714', name: 'Starlink-1007' },
];

// ── Parsing TLE ─────────────────────────────────────────────────────────────
/** Un TLE normalisé : nom optionnel (ligne 0) + les deux lignes de données. */
interface TleRecord {
  name: string;
  line1: string;
  line2: string;
}

/**
 * Ramène une longitude en degrés dans l'intervalle [-180, 180). Défensif :
 * selon les versions, degreesLong peut renvoyer 0..360 ; on normalise ici pour
 * garantir la même convention que le reste du cockpit (ordre GeoJSON).
 */
function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Extrait le numéro de catalogue NORAD d'une ligne 1 de TLE (colonnes 3–7,
 * indices 2..7 en base 0). Renvoie '' si la ligne est trop courte.
 * Ex. « 1 25544U 98067A   … » → « 25544 ».
 */
function noradFromLine1(line1: string): string {
  if (line1.length < 7) return '';
  return line1.slice(2, 7).trim();
}

/**
 * Parse un blob texte TLE (une OU plusieurs entrées concaténées) en TleRecord[].
 *
 * Format Celestrak « FORMAT=tle » = groupes de 3 lignes :
 *     <nom>            (ligne 0, optionnelle selon les flux)
 *     1 NNNNNU …       (ligne 1, commence par « 1 »)
 *     2 NNNNN  …       (ligne 2, commence par « 2 »)
 *
 * Robuste : on scanne les lignes, et dès qu'on voit une paire (ligne « 1 … »
 * suivie d'une ligne « 2 … »), on l'enregistre en prenant la ligne précédente
 * comme nom SI elle n'est pas elle-même une ligne TLE. Les messages d'erreur
 * Celestrak (ex. « No GP data found ») ne produisent aucune paire → ignorés.
 */
export function parseTle(text: string): TleRecord[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const out: TleRecord[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i];
    const l2 = lines[i + 1];
    // Une entrée valide = ligne 1 puis ligne 2 (préfixes « 1 » et « 2 »).
    if (l1.startsWith('1 ') && l2.startsWith('2 ')) {
      // La ligne juste avant est le nom, sauf si c'est déjà une ligne TLE
      // (cas d'un flux sans ligne 0 : on retombe sur le NORAD comme nom).
      const prev = i > 0 ? lines[i - 1] : '';
      const isPrevTle = prev.startsWith('1 ') || prev.startsWith('2 ');
      const name = prev && !isPrevTle ? prev : noradFromLine1(l1) || 'SAT';
      out.push({ name, line1: l1, line2: l2 });
      i += 1; // on saute la ligne 2 déjà consommée
    }
  }
  return out;
}

// ── Propagation d'un TLE → position ─────────────────────────────────────────
/**
 * Propage UN TLE à l'instant `date` et renvoie sa position géodésique, ou null
 * si le TLE est invalide / la propagation échoue (satellite décayé, éléments
 * hors domaine…). Fonction PURE : ne dépend que de ses arguments.
 */
export function positionFromTle(rec: TleRecord, date: Date): SatPosition | null {
  let satrec;
  try {
    satrec = twoline2satrec(rec.line1, rec.line2);
  } catch {
    return null; // TLE illisible → on ignore ce satellite
  }
  // satrec.error est un enum SatRecError où None = 0 : toute valeur truthy
  // signale un satrec construit mais non propageable (éléments hors domaine,
  // orbite décayée…). On abandonne proprement.
  if (satrec.error) return null;

  const pv = propagate(satrec, date);
  // propagate renvoie null en cas d'erreur SGP4 à cette date.
  if (!pv || !pv.position) return null;
  const eci = pv.position;
  if (
    !Number.isFinite(eci.x) ||
    !Number.isFinite(eci.y) ||
    !Number.isFinite(eci.z)
  ) {
    return null;
  }

  // ECI → géodésique : nécessite le GMST (temps sidéral) de la même date.
  const gmst = gstime(date);
  const geo = eciToGeodetic(eci, gmst);
  const lat = degreesLat(geo.latitude);
  const lng = wrapLongitude(degreesLong(geo.longitude));
  const alt = geo.height; // déjà en kilomètres

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(alt)) {
    return null;
  }

  return {
    id: noradFromLine1(rec.line1) || satrec.satnum || rec.name,
    name: rec.name,
    lat,
    lng,
    alt,
  };
}

/**
 * Point d'entrée principal : à partir d'un blob texte TLE (une ou plusieurs
 * entrées concaténées), calcule les positions instantanées de TOUS les
 * satellites lisibles à l'instant `date` (défaut : maintenant).
 *
 * Les entrées invalides / non propageables sont simplement omises (dégradation
 * douce, jamais d'exception). Renvoie [] si le blob ne contient aucun TLE.
 */
export function computeSatellites(tleText: string, date: Date = new Date()): SatPosition[] {
  const records = parseTle(tleText);
  const out: SatPosition[] = [];
  for (const rec of records) {
    const pos = positionFromTle(rec, date);
    if (pos) out.push(pos);
  }
  return out;
}
