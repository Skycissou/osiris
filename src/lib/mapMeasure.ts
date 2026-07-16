// ─────────────────────────────────────────────────────────────────────────
//  mapMeasure — géo-calculs PURS pour la boîte à outils « tracé & mesure » (P1)
//  ─────────────────────────────────────────────────────────────────────────
//  Zéro dépendance, zéro réseau : tout se calcule dans le navigateur.
//  Formules géodésiques standard (haversine + point-de-destination sphérique) —
//  précision « à vol d'oiseau » largement suffisante à l'échelle enquête
//  (< 0,5 % d'écart vs ellipsoïde sur des distances courtes).
//
//  Convention : LngLat = [lng, lat] (ordre GeoJSON, comme MapLibre).
// ─────────────────────────────────────────────────────────────────────────

export type LngLat = [number, number];

const R = 6371008.8; // rayon terrestre moyen (m) — IUGG mean radius
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Distance haversine entre 2 points, en mètres. */
export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const la1 = toRad(a[1]);
  const la2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longueur cumulée d'une polyligne (m). 0 si < 2 points. */
export function pathLengthM(pts: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += distanceM(pts[i - 1], pts[i]);
  return s;
}

/** Point situé à `distM` mètres et cap `bearingDeg` (0=N, 90=E) depuis `origin`. */
export function destination(origin: LngLat, distM: number, bearingDeg: number): LngLat {
  const d = distM / R;
  const br = toRad(bearingDeg);
  const la1 = toRad(origin[1]);
  const lo1 = toRad(origin[0]);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
  const lo2 =
    lo1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [((toDeg(lo2) + 540) % 360) - 180, toDeg(la2)]; // lng normalisé [-180,180]
}

/** Anneau polygonal (cercle géodésique) de rayon `radiusM` autour de `center`. */
export function circleRing(center: LngLat, radiusM: number, steps = 96): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) ring.push(destination(center, radiusM, (i * 360) / steps));
  return ring;
}

/** Aire d'un polygone fermé (m²) — intégrale sphérique (shoelace géodésique). */
export function polygonAreaM2(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lo1, la1] = ring[i];
    const [lo2, la2] = ring[(i + 1) % ring.length];
    total += toRad(lo2 - lo1) * (2 + Math.sin(toRad(la1)) + Math.sin(toRad(la2)));
  }
  return Math.abs((total * R * R) / 2);
}

/** Milieu géographique approché (moyenne des coords) — placement d'étiquette. */
export function midpoint(a: LngLat, b: LngLat): LngLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** Format FR compact d'une distance : « 540 m » / « 1,25 km » / « 42,3 km ». */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: km < 10 ? 2 : 1 })} km`;
}

/** Format FR compact d'une aire : « 820 m² » / « 3,4 ha » / « 1,25 km² ». */
export function fmtArea(m2: number): string {
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ha`;
  return `${(m2 / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km²`;
}
