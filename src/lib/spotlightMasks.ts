// ─────────────────────────────────────────────────────────────────────────────
//  spotlightMasks.ts — Masque « projecteur » des vues (demande Cissou 12/07)
//
//  Effet : assombrir TOUT le monde SAUF la région choisie (France / Europe) →
//  on ne « voit que » la France (ou l'Europe). Réalisé avec un polygone dont
//  l'anneau extérieur couvre le globe et les anneaux intérieurs (= trous) sont
//  la/les zone(s) à laisser éclairée(s). MapLibre remplit l'espace entre les deux.
//
//  Contours SIMPLIFIÉS (un masque n'a pas besoin d'être précis au mètre) :
//   • France métropolitaine (~hexagone, 21 sommets) + Corse (rectangle).
//   • Europe : fenêtre rectangulaire (region, pas un pays → cadre acceptable).
//  Aucune dépendance, importable client. Coordonnées en [lng, lat] (WGS84).
// ─────────────────────────────────────────────────────────────────────────────

export type SpotlightRegion = 'france' | 'europe' | null;

type Ring = [number, number][];

// Anneau extérieur = le monde entier (Web Mercator borné à ±85° de latitude).
const WORLD_RING: Ring = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

// France métropolitaine — contour simplifié (sens horaire depuis Dunkerque).
const FRANCE_RING: Ring = [
  [2.55, 51.07], [4.23, 49.96], [5.9, 49.49], [8.23, 48.97], [7.59, 47.59],
  [6.11, 46.13], [7.05, 45.92], [6.86, 45.13], [7.66, 43.79], [5.0, 43.0],
  [3.05, 43.02], [3.17, 42.43], [0.66, 42.69], [-1.79, 43.35], [-1.25, 46.16],
  [-2.55, 47.28], [-4.79, 48.09], [-1.61, 48.64], [-1.94, 49.73], [0.11, 49.5],
  [1.56, 50.95], [2.55, 51.07],
];

// Corse (rectangle englobant) — sinon elle resterait dans l'ombre.
const CORSICA_RING: Ring = [
  [8.5, 41.3], [9.62, 41.3], [9.62, 43.05], [8.5, 43.05], [8.5, 41.3],
];

// Europe — fenêtre rectangulaire (Irlande/Portugal → Europe de l'Est · Med → Scandinavie).
const EUROPE_RING: Ring = [
  [-12, 34], [40, 34], [40, 71], [-12, 71], [-12, 34],
];

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as unknown[] };

// ── Test « point dans la région » (pour SCOPER les données, pas juste la vue) ──
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
function pointInBox(lng: number, lat: number, ring: Ring): boolean {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** Un point est-il DANS la région ? France = forme réelle (métropole + Corse) →
 *  « que la France ». Europe = fenêtre. null (Monde) = tout passe. */
export function isInRegion(lng: number, lat: number, region: SpotlightRegion): boolean {
  if (!region) return true;
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  if (region === 'france') return pointInRing(lng, lat, FRANCE_RING) || pointInBox(lng, lat, CORSICA_RING);
  return pointInBox(lng, lat, EUROPE_RING);
}

/** GeoJSON du masque pour la région (ou vide si aucune → pas d'assombrissement). */
export function spotlightMask(region: SpotlightRegion) {
  if (!region) return EMPTY_FC;
  const holes = region === 'france' ? [FRANCE_RING, CORSICA_RING] : [EUROPE_RING];
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [WORLD_RING, ...holes] },
      },
    ],
  };
}
