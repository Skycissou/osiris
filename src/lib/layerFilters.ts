// ─────────────────────────────────────────────────────────────────────────────
//  layerFilters.ts — Filtres d'ATTRIBUTS des couches temps réel (OSIRIS V4 · cockpit)
//  Agent MODULE FILTRES DE COUCHE
//
//  RÔLE
//  ────
//  Filtrer DANS une couche DÉJÀ affichée (ne pas confondre avec le toggle
//  d'activation d'une couche, géré ailleurs). Exemple : la couche « avions » est
//  active, mais l'enquêteur ne veut voir que les aéronefs au-dessus de 10 000 ft,
//  ou seulement les VIP. Ce module définit le MODÈLE de filtres (`LayerFilters`)
//  et les fonctions PURES qui l'appliquent aux tableaux de points.
//
//  PRINCIPES
//  ─────────
//  • 100 % pur : aucune dépendance React, aucun effet de bord, jamais de `throw`.
//    Robuste aux champs `undefined` / valeurs non numériques (dégradation douce).
//  • « Aucun filtre » = tout passe. Un objet de filtres vide (`{}`) est neutre.
//  • Un critère de plage (min/max) ACTIF exclut les points dont le champ concerné
//    est absent ou non numérique : on ne peut pas confirmer qu'ils respectent la
//    borne, on préfère ne pas les afficher tant que le filtre est posé.
//  • Un filtre texte (« contient ») est insensible à la casse ; vide = neutre.
//
//  Les types de points proviennent du châssis carto (OsirisMap) : on importe
//  uniquement les TYPES (`import type`) pour rester un module sans runtime lourd.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AircraftPoint,
  QuakePoint,
  ShipPoint,
  GeoEventPoint,
  CyberPoint,
} from '@/components/OsirisMap';

// ── Clés de couche filtrables ─────────────────────────────────────────────────
/**
 * Identifiant logique d'une couche filtrable. NB : ce sont les clés « courtes »
 * du modèle de filtres (`aircraft`, `earthquakes`…), à ne pas confondre avec les
 * clés `activeLayers` du cockpit qui sont préfixées `live_` (`live_aircraft`…).
 */
export type FilterableLayerKey =
  | 'aircraft'
  | 'earthquakes'
  | 'ships'
  | 'gdelt'
  | 'cyber';

/** Liste figée des couches filtrables (utile pour itérer / compter). */
export const FILTERABLE_LAYER_KEYS: readonly FilterableLayerKey[] = [
  'aircraft',
  'earthquakes',
  'ships',
  'gdelt',
  'cyber',
] as const;

// ── Modèle de filtres, par couche ─────────────────────────────────────────────
/**
 * Filtres de la couche AVIONS (adsb.lol).
 *  - `altMin` / `altMax` : altitude en pieds (champ `alt`).
 *  - `speedMin` / `speedMax` : vitesse sol (champ `speed`).
 *  - `militaryOnly` : ne garder que les aéronefs identifiés « militaires »
 *    (heuristique sur `vipCategory` / `category`, cf. isMilitaryAircraft).
 *  - `vipOnly` : ne garder que les aéronefs taggés watchlist VIP (`vip === true`).
 */
export interface AircraftFilter {
  altMin?: number;
  altMax?: number;
  speedMin?: number;
  speedMax?: number;
  militaryOnly?: boolean;
  vipOnly?: boolean;
}

/**
 * Filtres de la couche SÉISMES (USGS).
 *  - `magMin` : magnitude minimale (champ `mag`).
 */
export interface EarthquakeFilter {
  magMin?: number;
}

/**
 * Filtres de la couche NAVIRES (AIS).
 *  - `speedMin` / `speedMax` : vitesse en nœuds (champ `speed`).
 *  - `type` : filtre texte « contient » sur le type de navire (champ `type`).
 */
export interface ShipFilter {
  speedMin?: number;
  speedMax?: number;
  type?: string;
}

/**
 * Filtres de la couche GÉOPOLITIQUE (GDELT).
 *  - `toneMin` / `toneMax` : tonalité de l'événement (champ `tone`,
 *    typiquement de -10 très négatif à +10 très positif).
 */
export interface GdeltFilter {
  toneMin?: number;
  toneMax?: number;
}

/**
 * Filtres de la couche CYBER (serveurs C2, abuse.ch).
 *  - `malware` : filtre texte « contient » sur la famille de malware (champ `malware`).
 *  - `country` : filtre texte « contient » sur le pays (champ `country`).
 */
export interface CyberFilter {
  malware?: string;
  country?: string;
}

/**
 * Modèle complet des filtres actifs, une entrée par couche filtrable.
 * Toute clé absente ⇒ couche non filtrée (tous les points passent).
 */
export interface LayerFilters {
  aircraft?: AircraftFilter;
  earthquakes?: EarthquakeFilter;
  ships?: ShipFilter;
  gdelt?: GdeltFilter;
  cyber?: CyberFilter;
}

/** Filtres par défaut : AUCUN critère (tout passe). */
export const DEFAULT_FILTERS: LayerFilters = {};

// ── Helpers internes (purs, tolérants) ────────────────────────────────────────
/**
 * true si `value` respecte la plage [min, max]. Bornes optionnelles.
 * Si aucune borne n'est posée → neutre (true). Si une borne est posée mais que
 * `value` n'est pas un nombre fini → false (on ne peut pas confirmer la borne).
 */
function passesRange(value: number | undefined, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * true si `haystack` contient `needle` (insensible à la casse). `needle` vide /
 * absent → neutre (true). `haystack` absent avec un `needle` non vide → false.
 */
function contains(haystack: string | undefined, needle?: string): boolean {
  const q = (needle ?? '').trim().toLowerCase();
  if (!q) return true;
  return (haystack ?? '').toLowerCase().includes(q);
}

/**
 * Heuristique « aéronef militaire » : les données ADS-B ne portent pas de champ
 * militaire explicite ; on s'appuie sur la catégorie VIP dédiée
 * (`vipCategory === 'militaire'`) ou sur un indice dans `category`. Best-effort,
 * volontairement tolérant.
 */
function isMilitaryAircraft(a: AircraftPoint): boolean {
  const vipCat = (a.vipCategory ?? '').toLowerCase();
  const adsbCat = (a.category ?? '').toLowerCase();
  return vipCat.includes('milit') || adsbCat.includes('milit') || adsbCat === 'mil';
}

/**
 * true si un objet de filtres porte AU MOINS un critère « actif » :
 *  - un nombre fini,
 *  - un booléen à true,
 *  - une chaîne non vide (après trim).
 * Les valeurs `undefined` / `false` / '' / NaN sont considérées inactives.
 */
function hasActiveCriterion(filter: object | undefined): boolean {
  if (!filter) return false;
  return Object.values(filter).some((v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'boolean') return v === true;
    if (typeof v === 'string') return v.trim().length > 0;
    return false;
  });
}

// ── Fonctions de filtrage PURES, par couche ───────────────────────────────────
/**
 * Filtre le tableau d'avions selon `f`. `items` non-tableau ou `f` absent →
 * renvoie `items` tel quel. Ne throw jamais.
 */
export function applyAircraftFilter(items: AircraftPoint[], f?: AircraftFilter): AircraftPoint[] {
  if (!Array.isArray(items)) return items;
  if (!hasActiveCriterion(f)) return items;
  return items.filter((a) => {
    if (!a) return false;
    if (!passesRange(a.alt, f?.altMin, f?.altMax)) return false;
    if (!passesRange(a.speed, f?.speedMin, f?.speedMax)) return false;
    if (f?.militaryOnly && !isMilitaryAircraft(a)) return false;
    if (f?.vipOnly && a.vip !== true) return false;
    return true;
  });
}

/**
 * Filtre le tableau de séismes selon `f` (magnitude minimale). Un séisme sans
 * magnitude numérique est exclu si `magMin` est posé. Ne throw jamais.
 */
export function applyQuakeFilter(items: QuakePoint[], f?: EarthquakeFilter): QuakePoint[] {
  if (!Array.isArray(items)) return items;
  if (!hasActiveCriterion(f)) return items;
  return items.filter((q) => {
    if (!q) return false;
    if (!passesRange(q.mag, f?.magMin, undefined)) return false;
    return true;
  });
}

/**
 * Filtre le tableau de navires selon `f` (plage de vitesse + type texte).
 * Ne throw jamais.
 */
export function applyShipFilter(items: ShipPoint[], f?: ShipFilter): ShipPoint[] {
  if (!Array.isArray(items)) return items;
  if (!hasActiveCriterion(f)) return items;
  return items.filter((s) => {
    if (!s) return false;
    if (!passesRange(s.speed, f?.speedMin, f?.speedMax)) return false;
    if (!contains(s.type, f?.type)) return false;
    return true;
  });
}

/**
 * Filtre le tableau d'événements géopolitiques selon `f` (plage de tonalité).
 * Ne throw jamais.
 */
export function applyGdeltFilter(items: GeoEventPoint[], f?: GdeltFilter): GeoEventPoint[] {
  if (!Array.isArray(items)) return items;
  if (!hasActiveCriterion(f)) return items;
  return items.filter((g) => {
    if (!g) return false;
    if (!passesRange(g.tone, f?.toneMin, f?.toneMax)) return false;
    return true;
  });
}

/**
 * Filtre le tableau de serveurs C2 cyber selon `f` (malware + pays, texte).
 * Ne throw jamais.
 */
export function applyCyberFilter(items: CyberPoint[], f?: CyberFilter): CyberPoint[] {
  if (!Array.isArray(items)) return items;
  if (!hasActiveCriterion(f)) return items;
  return items.filter((c) => {
    if (!c) return false;
    if (!contains(c.malware, f?.malware)) return false;
    if (!contains(c.country, f?.country)) return false;
    return true;
  });
}

// ── Dispatcher générique ──────────────────────────────────────────────────────
/**
 * Route le filtrage vers la bonne fonction selon la clé de couche et renvoie les
 * items CONSERVÉS. Si `layerKey` est inconnue, si `items` n'est pas un tableau,
 * ou si aucun filtre n'est défini pour la couche → renvoie `items` tel quel.
 *
 * Générique sur `T` pour rester câblable côté carte sans casse de type : les
 * conversions internes sont sûres car le filtrage ne modifie jamais les objets,
 * il ne fait que les conserver ou les écarter.
 *
 * @param layerKey clé de couche ('aircraft'|'earthquakes'|'ships'|'gdelt'|'cyber').
 * @param items    tableau de points de la couche.
 * @param filters  modèle de filtres global.
 * @returns le sous-ensemble d'`items` qui passe le filtre de la couche.
 */
export function applyFilter<T>(layerKey: string, items: T[], filters: LayerFilters): T[] {
  if (!Array.isArray(items)) return items;
  const f = filters ?? DEFAULT_FILTERS;
  switch (layerKey) {
    case 'aircraft':
      return applyAircraftFilter(items as unknown as AircraftPoint[], f.aircraft) as unknown as T[];
    case 'earthquakes':
      return applyQuakeFilter(items as unknown as QuakePoint[], f.earthquakes) as unknown as T[];
    case 'ships':
      return applyShipFilter(items as unknown as ShipPoint[], f.ships) as unknown as T[];
    case 'gdelt':
      return applyGdeltFilter(items as unknown as GeoEventPoint[], f.gdelt) as unknown as T[];
    case 'cyber':
      return applyCyberFilter(items as unknown as CyberPoint[], f.cyber) as unknown as T[];
    default:
      // Couche non filtrable (satellites, feux, sensibles…) → aucun filtrage.
      return items;
  }
}

// ── Introspection (badges / UI) ───────────────────────────────────────────────
/**
 * true si la couche `layerKey` a au moins un critère actif dans `filters`.
 * Renvoie false pour une couche non filtrable ou sans critère.
 */
export function isFilterActive(filters: LayerFilters, layerKey: string): boolean {
  switch (layerKey) {
    case 'aircraft':
      return hasActiveCriterion(filters?.aircraft);
    case 'earthquakes':
      return hasActiveCriterion(filters?.earthquakes);
    case 'ships':
      return hasActiveCriterion(filters?.ships);
    case 'gdelt':
      return hasActiveCriterion(filters?.gdelt);
    case 'cyber':
      return hasActiveCriterion(filters?.cyber);
    default:
      return false;
  }
}

/**
 * Nombre de couches ayant au moins un critère actif (utile pour un badge sur le
 * bouton « Filtres »). 0 si aucun filtre posé.
 */
export function activeFilterCount(filters: LayerFilters): number {
  if (!filters) return 0;
  return FILTERABLE_LAYER_KEYS.reduce(
    (n, key) => (isFilterActive(filters, key) ? n + 1 : n),
    0,
  );
}
