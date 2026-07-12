// ─────────────────────────────────────────────────────────────────────────────
//  alertZones.ts — Contour du DÉPARTEMENT d'une alerte (demande Cissou 12/07)
//
//  Objectif : matérialiser chaque alerte de disparition par le CONTOUR RÉEL de
//  son département (tracé rouge clignotant sur la carte), en plus du point.
//
//  100 % HORS-LIGNE, zéro API (les APIs gouv sont souvent bloquées depuis le VPS)
//  → on embarque un GeoJSON simplifié des départements FR (`data/departementsFr.json`,
//  ~248 Ko, coords 4 décimales) et on trouve le bon département par POINT-DANS-
//  POLYGONE depuis la lat/lon déjà géocodée de l'alerte. Le GeoJSON est chargé en
//  import dynamique (chunk séparé) → il ne pèse que si la couche Alertes est active.
//
//  Source du tracé : github.com/gregoiredavid/france-geojson (départements simplifiés).
// ─────────────────────────────────────────────────────────────────────────────

export interface DeptFeature {
  type: 'Feature';
  properties: { code: string; nom: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}
export interface DeptFC {
  type: 'FeatureCollection';
  features: DeptFeature[];
}

let _cache: DeptFC | null = null;

/** Charge (une fois) le GeoJSON des départements — chunk séparé, à la demande. */
export async function loadDepartements(): Promise<DeptFC> {
  if (!_cache) {
    const mod = await import('@/data/departementsFr.json');
    _cache = ((mod as unknown as { default?: DeptFC }).default ?? (mod as unknown)) as DeptFC;
  }
  return _cache;
}

// Ray-casting sur un anneau (on ignore les trous : un département n'en a pas de
// pertinent pour un simple contour, et une enclave resterait un match correct).
function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function pointInFeature(lng: number, lat: number, f: DeptFeature): boolean {
  const g = f.geometry;
  if (g.type === 'Polygon') return pointInRing(lng, lat, (g.coordinates as number[][][])[0]);
  if (g.type === 'MultiPolygon') return (g.coordinates as number[][][][]).some((poly) => pointInRing(lng, lat, poly[0]));
  return false;
}

/**
 * Départements contenant AU MOINS un des points (dédupliqués par code), renvoyés
 * en FeatureCollection prête pour MapLibre (une entrée = un contour à dessiner).
 */
export function departementsForPoints(points: { lng: number; lat: number }[], fc: DeptFC): DeptFC {
  const codes = new Set<string>();
  for (const p of points) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
    const f = fc.features.find((ft) => pointInFeature(p.lng, p.lat, ft));
    if (f) codes.add(f.properties.code);
  }
  return { type: 'FeatureCollection', features: fc.features.filter((ft) => codes.has(ft.properties.code)) };
}
