// ─────────────────────────────────────────────────────────────────────────
//  Centroïde de département (repli géo hors-ligne) — dérivé du GeoJSON FR déjà
//  embarqué (src/data/departementsFr.json, V4.079). Sert quand la ville n'est pas
//  résolue : pin au centre du département + précision « approx. ». 100 % offline.
//  ⚠️ Métropole + Corse uniquement (96 depts) : DOM (Réunion 974…) absents → null
//  (ces avis resteront en liste tant que la ville n'est pas géocodée).
// ─────────────────────────────────────────────────────────────────────────

import departements from '@/data/departementsFr.json';

type LatLon = { lat: number; lon: number };

interface DeptFeature {
  properties: { code: string; nom: string };
  geometry: { type: string; coordinates: number[][][] | number[][][][] };
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const byCode = new Map<string, LatLon>();
const byNom = new Map<string, LatLon>();

function ringCentroid(coords: number[][]): LatLon | null {
  let sx = 0, sy = 0, n = 0;
  for (const pt of coords) {
    if (Array.isArray(pt) && pt.length >= 2) { sx += pt[0]; sy += pt[1]; n++; }
  }
  return n ? { lat: sy / n, lon: sx / n } : null;
}

function featureCentroid(f: DeptFeature): LatLon | null {
  const g = f.geometry;
  // Polygon → coordinates[0] = anneau externe. MultiPolygon → premier polygone.
  const ring = g.type === 'MultiPolygon'
    ? (g.coordinates as number[][][][])[0]?.[0]
    : (g.coordinates as number[][][])[0];
  return ring ? ringCentroid(ring) : null;
}

let built = false;
function build(): void {
  if (built) return;
  built = true;
  for (const f of (departements as { features: DeptFeature[] }).features) {
    const c = featureCentroid(f);
    if (!c) continue;
    byCode.set(String(f.properties.code).toUpperCase(), c);
    byNom.set(norm(f.properties.nom), c);
  }
}

/** Centroïde par code INSEE dépt ("77", "2B"…) ou nom ("Seine-et-Marne"). null si inconnu. */
export function deptCentroid(code: string | null, nom: string | null): LatLon | null {
  build();
  if (code) {
    const c = byCode.get(code.toUpperCase());
    if (c) return c;
  }
  if (nom) {
    const c = byNom.get(norm(nom));
    if (c) return c;
  }
  return null;
}
