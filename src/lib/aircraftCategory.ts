// ─────────────────────────────────────────────────────────────────────────────
//  aircraftCategory.ts — Couleur/catégorie d'un avion (pur, testable)
//
//  Problème (retour Cissou 07/07 : « les avions sont toujours bleus ») : la
//  catégorie émetteur ADS-B (`category` A1..A7) n'est renvoyée par adsb.lol que
//  pour une PARTIE des avions → sans elle, tout retombait sur « inconnu ».
//  Remède : cascade de signaux, du plus fort au plus faible —
//    urgence (squawk 7500/7600/7700 ou champ emergency) → militaire (dbFlags)
//    → category ADS-B → REPLI sur le TYPE ICAO (`t`, ex. A320, A388, EC35).
//  Résultat : la quasi-totalité des avions est colorée, plus juste du bleu.
// ─────────────────────────────────────────────────────────────────────────────

export type AircraftCatKey = 'emergency' | 'mil' | 'heavy' | 'large' | 'rotor' | 'light' | 'default';

/** Couleur par catégorie (icône générée + légende). */
export const AIRCRAFT_CAT_COLORS: Record<AircraftCatKey, string> = {
  emergency: '#ff3b46', // urgence (7500/7600/7700) — rouge vif
  mil: '#e0555f', // militaire (bit dbFlags) — rouge
  heavy: '#f0a35e', // gros porteur — orange
  large: '#c9a2ff', // grand avion (narrow-body / régional) — violet
  rotor: '#7cffb2', // hélicoptère / giravion — vert
  light: '#9bdcf0', // avion léger / aviation générale — cyan
  default: '#8fa6bd', // autre / inconnu — gris-bleu
};

/** Libellés FR pour la légende (ordre d'affichage). */
export const AIRCRAFT_CAT_LABELS: Record<AircraftCatKey, string> = {
  emergency: 'Urgence (7700…)',
  mil: 'Militaire',
  heavy: 'Gros porteur',
  large: 'Grand avion',
  rotor: 'Hélicoptère',
  light: 'Avion léger',
  default: 'Autre / inconnu',
};

/** Ordre de la légende. */
export const AIRCRAFT_CAT_ORDER: AircraftCatKey[] = ['emergency', 'mil', 'heavy', 'large', 'rotor', 'light', 'default'];

// Types ICAO gros porteurs (long-courriers gros / très gros).
const HEAVY = new Set([
  'A388', 'A345', 'A346', 'A343', 'A342', 'A359', 'A35K', 'A339', 'A338', 'A333', 'A332', 'A337',
  'B748', 'B744', 'B742', 'B743', 'B77W', 'B77L', 'B772', 'B773', 'B778', 'B779',
  'B788', 'B789', 'B78X', 'B762', 'B763', 'B764', 'A306', 'A30B', 'A310', 'MD11', 'IL96', 'B74S', 'AN24',
  'C5M', 'C17', 'K35R', 'E767', 'B52', 'A400',
]);
// Types militaires par ICAO (repli si dbFlags absent).
const MIL_TYPES = new Set([
  'F16', 'F15', 'F18', 'F22', 'F35', 'EUFI', 'RFAL', 'A400', 'C130', 'C30J', 'H60', 'AH64', 'E3TF',
  'P8', 'KC35', 'K35R', 'B52', 'C17', 'C5M', 'A10', 'TOR', 'MIG', 'SU', 'H47',
]);

/** true si le code transpondeur est un squawk d'urgence international. */
function isEmergencySquawk(squawk?: string): boolean {
  const s = (squawk ?? '').trim();
  return s === '7500' || s === '7600' || s === '7700';
}

/** Repli type ICAO → catégorie de taille (préfixes courants). */
function keyFromType(acType?: string): AircraftCatKey | null {
  const t = (acType ?? '').toUpperCase().trim();
  if (!t) return null;
  if (MIL_TYPES.has(t)) return 'mil';
  if (HEAVY.has(t)) return 'heavy';
  // Hélicoptères : préfixes constructeurs courants + suffixe.
  if (/^(EC|AS|H\d|R44|R66|B06|B47|A139|A169|A189|S76|S92|H1|H2|EH10|MI\d)/.test(t)) return 'rotor';
  // Narrow-body / régionaux (Airbus A320 family, Boeing 737, Embraer, CRJ…).
  if (/^(A19N|A20N|A21N|A318|A319|A320|A321|B73|B37|E17|E19|E29|E75|CRJ|CL60|BCS|E135|E145|AT[47]|DH8|SF34)/.test(t)) return 'large';
  // Aviation générale / légers (Cessna, Piper, Cirrus, Diamond, Beech…).
  if (/^(C1[0-9][0-9]|C2[0-9][0-9]|P28|PA\d|SR2|SR22|DA[0-9]|DA42|BE\d|C82|TBM|PC12|GLF|C25|C56|E50|E55)/.test(t)) return 'light';
  return null;
}

/**
 * Catégorie de couleur d'un avion, cascade : urgence → militaire → category
 * ADS-B → type ICAO → défaut.
 */
export function aircraftCatKey(opts: {
  category?: string;
  mil?: boolean;
  acType?: string;
  squawk?: string;
  emergency?: string;
}): AircraftCatKey {
  if (isEmergencySquawk(opts.squawk) || (opts.emergency && opts.emergency !== 'none')) return 'emergency';
  if (opts.mil) return 'mil';
  const c = (opts.category ?? '').toUpperCase();
  if (c === 'A5') return 'heavy';
  if (c === 'A3' || c === 'A4') return 'large';
  if (c === 'A7') return 'rotor';
  if (c === 'A1' || c === 'A2') return 'light';
  return keyFromType(opts.acType) ?? 'default';
}
