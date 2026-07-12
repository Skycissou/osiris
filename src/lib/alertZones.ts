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

// ── Hiérarchie de gravité (demande Cissou 12/07 : « ne pas tout faire clignoter ») ──
//  3 = critique (clignote) · 2 = moyen (statique) · 1 = bas (discret). Un avis LEVÉ
//  n'est jamais urgent. Les enlèvements / disparitions inquiétantes priment ; sinon
//  la récence (< 7 j) fait monter d'un cran. Pur & testable.
export function alertSeverity(categorie: string | undefined, statut: string | undefined, ageH: number): number {
  if (statut === 'levee') return 1;
  const c = (categorie ?? '').toLowerCase();
  if (/enlev|inquiet|alerte/.test(c)) return 3;
  if (Number.isFinite(ageH) && ageH < 24 * 7) return 2;
  return 1;
}
export type AlertTier = 'critical' | 'medium' | 'low';
export function tierOf(sev: number): AlertTier {
  return sev >= 3 ? 'critical' : sev >= 2 ? 'medium' : 'low';
}

/**
 * Départements contenant ≥1 alerte (dédupliqués par code), avec la gravité MAX
 * de leurs avis (`sev` numérique + `tier` texte), en FeatureCollection MapLibre.
 * Un département dessiné 1 fois, au niveau de sa alerte la plus grave.
 */
export function departementsForPoints(points: { lng: number; lat: number; sev?: number }[], fc: DeptFC): DeptFC {
  const sevByCode = new Map<string, number>();
  for (const p of points) {
    if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) continue;
    const f = fc.features.find((ft) => pointInFeature(p.lng, p.lat, ft));
    if (f) {
      const code = f.properties.code;
      sevByCode.set(code, Math.max(sevByCode.get(code) ?? 0, p.sev ?? 1));
    }
  }
  return {
    type: 'FeatureCollection',
    features: fc.features
      .filter((ft) => sevByCode.has(ft.properties.code))
      .map((ft) => {
        const sev = sevByCode.get(ft.properties.code) as number;
        return { ...ft, properties: { ...ft.properties, sev, tier: tierOf(sev) } };
      }),
  };
}
