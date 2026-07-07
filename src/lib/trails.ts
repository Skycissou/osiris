'use client';

// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — TRAILS : traînées (routes tracées) des mobiles.
//
//  RÔLE
//  ----
//  Chaque avion / navire (toute entité mobile) laisse derrière lui une
//  « traînée » : la polyligne de ses positions passées, qui s'estompe avec
//  l'âge (dégradé d'opacité). Ce module tient un historique EN MÉMOIRE des
//  positions et le transforme en GeoJSON prêt à peindre par MapLibre.
//
//  Pattern « trails » inspiré de la référence OSINT externe (projet AGPL) mais
//  INTÉGRALEMENT ré-écrit en clean-room : aucune ligne copiée, aucune
//  dépendance ajoutée, aucune structure importée. Seule l'idée générale
//  (buffer d'historique par entité → LineString estompée) est reprise.
//
//  CONTRAT / DESIGN
//  ----------------
//  • Buffer par couche ('aircraft', 'ships', …) PUIS par id d'entité :
//        Map<layerKey, Map<entityId, TrailPoint[]>>
//    Les points sont stockés du plus ANCIEN (index 0) au plus RÉCENT (fin),
//    ce qui donne directement l'ordre de tracé d'une LineString.
//  • `now` est TOUJOURS fourni par l'appelant (jamais de Date.now() interne) :
//    pureté / testabilité / cohérence avec le tick d'interpolation et le SSR.
//  • Élagage double à chaque enregistrement : par ÂGE (maxAgeMs, défaut 10 min)
//    et par NOMBRE (maxPoints, défaut 60). Le plus contraignant gagne.
//  • `buildTrails` renvoie une FeatureCollection de LineStrings (une par
//    entité ayant ≥ 2 points), chaque feature portant :
//        properties.id       → id de l'entité (jointure carte ↔ popup)
//        properties.ageRatio → 0 = traînée fraîche … 1 = traînée au bord de
//                              l'expiration, pour piloter un `line-opacity`.
//    ageRatio est calculé sur le point le PLUS VIEUX encore vivant : plus la
//    traînée est ancienne dans son ensemble, plus elle est fantomatique.
//  • Wrap de longitude : on NE relie JAMAIS deux points séparés de plus de
//    180° de longitude (ex. un mobile qui franchit l'antiméridien ±180°) —
//    sinon MapLibre tire un trait horizontal en travers de toute la carte.
//    Un tel saut COUPE la traînée en plusieurs LineStrings (MultiLineString-
//    like via features séparées partageant le même id).
//
//  ── EXEMPLE D'INTÉGRATION DANS OsirisMap ──────────────────────────────────
//  1) Au montage de la carte, déclarer une source + une couche `line` par
//     couche de mobiles (ici les avions) :
//
//        map.addSource('aircraft-trails', { type: 'geojson', data: EMPTY_FC });
//        map.addLayer({
//          id: 'aircraft-trails-line',
//          type: 'line',
//          source: 'aircraft-trails',
//          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
//          paint: {
//            'line-color': '#9bdcf0',
//            'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 10, 2.5],
//            // ageRatio 0 (frais) → opacité 0.9 ; 1 (vieux) → 0.0 (invisible).
//            'line-opacity': [
//              'interpolate', ['linear'], ['get', 'ageRatio'],
//              0, 0.9,
//              1, 0.0,
//            ],
//          },
//        }, 'live-aircraft-symbols'); // SOUS la couche des symboles avions.
//
//  2) À CHAQUE fetch live (dans le merge du store, ou juste après), on
//     enregistre la position courante de chaque mobile avec l'horloge du tick :
//
//        const avions = getSnapshotKey<MovingEntity[] & {id:string}[]>('aircraft') ?? [];
//        recordPositions('aircraft', avions.map((a) => ({ id: a.id, lat: a.lat, lng: a.lng })), Date.now());
//        pruneEntities('aircraft', new Set(avions.map((a) => a.id))); // purge des disparus.
//
//  3) À CHAQUE tick d'interpolation (useInterpolation), on reconstruit le
//     GeoJSON estompé et on le pousse dans la source :
//
//        useInterpolation(() => {
//          const now = Date.now();
//          const fc = buildTrails('aircraft', now);
//          (map.getSource('aircraft-trails') as maplibregl.GeoJSONSource)?.setData(fc);
//        });
//
//  4) Toggle de visibilité de la couche via setVis(['aircraft-trails-line'], on),
//     et clearTrails('aircraft') si l'utilisateur masque la couche avions
//     (libère la mémoire ; l'historique se reconstruit au prochain fetch).
// ─────────────────────────────────────────────────────────────────────────

// ── Types exportés ─────────────────────────────────────────────────────────

/** Un point d'historique : position horodatée d'une entité. */
export interface TrailPoint {
  lat: number; // degrés
  lng: number; // degrés
  /** Horodatage (ms epoch) fourni par l'appelant au moment de l'enregistrement. */
  t: number;
}

/** Options d'élagage / de construction des traînées. */
export interface TrailOptions {
  /** Âge maximal d'un point conservé, en ms (défaut 600 000 = 10 min). */
  maxAgeMs?: number;
  /** Nombre maximal de points conservés par entité (défaut 60). */
  maxPoints?: number;
}

// ── Constantes / défauts ───────────────────────────────────────────────────

/** Âge maximal par défaut d'un point de traînée : 10 minutes. */
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;
/** Nombre maximal de points par défaut et par entité. */
const DEFAULT_MAX_POINTS = 60;
/**
 * Seuil de wrap de longitude (degrés). Un écart Δlng strictement supérieur
 * indique un franchissement de l'antiméridien (ou un téléport de données) :
 * on ne relie pas ces deux points, on coupe la traînée.
 */
const LNG_WRAP_THRESHOLD = 180;

// ── Buffer d'historique en mémoire ─────────────────────────────────────────
//  Singleton module-level : Map<layerKey, Map<entityId, TrailPoint[]>>.
//  Les points sont ordonnés du plus ancien (0) au plus récent (fin).
const buffers = new Map<string, Map<string, TrailPoint[]>>();

/** Renvoie (en le créant au besoin) le buffer d'une couche. */
function bufferFor(layerKey: string): Map<string, TrailPoint[]> {
  let layer = buffers.get(layerKey);
  if (!layer) {
    layer = new Map<string, TrailPoint[]>();
    buffers.set(layerKey, layer);
  }
  return layer;
}

/**
 * Élague un historique EN PLACE : supprime d'abord les points plus vieux que
 * `maxAgeMs` (relatif à `now`), puis, s'il en reste trop, ne garde que les
 * `maxPoints` DERNIERS (les plus récents). Comme les points sont triés du
 * plus ancien au plus récent, l'élagage par âge se fait par la tête et
 * l'élagage par nombre par la queue.
 */
function prunePoints(points: TrailPoint[], now: number, maxAgeMs: number, maxPoints: number): TrailPoint[] {
  const minT = now - maxAgeMs;
  // 1) Coupe par âge : on cherche le 1er point encore vivant (ordre croissant en t).
  let firstAlive = 0;
  while (firstAlive < points.length && points[firstAlive].t < minT) firstAlive++;
  let out = firstAlive > 0 ? points.slice(firstAlive) : points;
  // 2) Coupe par nombre : on garde les maxPoints derniers (les plus récents).
  if (out.length > maxPoints) out = out.slice(out.length - maxPoints);
  return out;
}

/**
 * Enregistre la position COURANTE de chaque entité dans l'historique de sa
 * couche, puis élague (âge + nombre). Appelé typiquement à chaque fetch live.
 *
 * • `now` est l'horloge de l'appelant (testabilité SSR : pas de Date.now interne).
 * • Une position dont lat/lng n'est pas un nombre fini est ignorée (donnée sale).
 * • Un doublon horodaté (même `t` que le dernier point enregistré) est écrasé
 *   plutôt qu'empilé, pour ne pas gonfler le buffer si l'appelant tire deux
 *   fois sur le même tick.
 */
export function recordPositions(
  layerKey: string,
  entities: { id: string; lat: number; lng: number }[],
  now: number,
  opts?: TrailOptions,
): void {
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxPoints = opts?.maxPoints ?? DEFAULT_MAX_POINTS;
  const layer = bufferFor(layerKey);

  for (const e of entities) {
    if (!e || typeof e.id !== 'string') continue;
    if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) continue;

    let points = layer.get(e.id);
    if (!points) {
      points = [];
      layer.set(e.id, points);
    }
    const last = points[points.length - 1];
    if (last && last.t === now) {
      // Même tick : on met à jour la dernière position au lieu d'en ajouter une.
      last.lat = e.lat;
      last.lng = e.lng;
    } else {
      points.push({ lat: e.lat, lng: e.lng, t: now });
    }
    // Élagage immédiat : borne mémoire à chaque enregistrement.
    const pruned = prunePoints(points, now, maxAgeMs, maxPoints);
    if (pruned !== points) layer.set(e.id, pruned);
  }
}

/**
 * Construit la FeatureCollection des traînées d'une couche à l'instant `now`.
 *
 * • Une feature LineString par SEGMENT continu d'au moins 2 points. Un même
 *   id peut donner PLUSIEURS features s'il a franchi l'antiméridien (coupe).
 * • `properties.ageRatio` ∈ [0, 1] : 0 = traînée fraîche, 1 = traînée dont le
 *   point le plus ancien atteint `maxAgeMs`. Sert de driver à `line-opacity`.
 * • Les points expirés sont écartés à la lecture aussi (au cas où aucun
 *   recordPositions n'a tourné depuis un moment) — sans muter le buffer.
 */
export function buildTrails(
  layerKey: string,
  now: number,
  opts?: TrailOptions,
): GeoJSON.FeatureCollection<GeoJSON.LineString, { id: string; ageRatio: number }> {
  const maxAgeMs = opts?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const features: GeoJSON.Feature<GeoJSON.LineString, { id: string; ageRatio: number }>[] = [];
  const layer = buffers.get(layerKey);

  if (layer) {
    const minT = now - maxAgeMs;
    for (const [id, rawPoints] of layer) {
      // Filtre les points expirés à la lecture (lecture pure, sans mutation).
      const points = rawPoints[0] && rawPoints[0].t < minT
        ? rawPoints.filter((p) => p.t >= minT)
        : rawPoints;
      if (points.length < 2) continue;

      // Découpe en segments continus (coupe à chaque saut de longitude > 180°).
      let seg: GeoJSON.Position[] = [[points[0].lng, points[0].lat]];
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const cur = points[i];
        if (Math.abs(cur.lng - prev.lng) > LNG_WRAP_THRESHOLD) {
          // Franchissement antiméridien : on clôt le segment courant et on repart.
          if (seg.length >= 2) features.push(makeFeature(id, seg, points, now, maxAgeMs));
          seg = [[cur.lng, cur.lat]];
        } else {
          seg.push([cur.lng, cur.lat]);
        }
      }
      if (seg.length >= 2) features.push(makeFeature(id, seg, points, now, maxAgeMs));
    }
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Fabrique une feature LineString estompée. `ageRatio` est dérivé du point le
 * plus RÉCENT de l'entité : une entité qui ÉMET ENCORE garde ratio ≈ 0 → sa
 * traînée reste pleinement visible ; le fondu ne démarre que quand elle cesse
 * d'émettre (disparue du flux) et s'achève à maxAgeMs.
 *
 * 🐛 Corrigé le 07/07 (retour Cissou « on ne voit pas les routes ») : l'ancien
 * calcul partait du point le plus ANCIEN → dès ~10 min de suivi, ratio ≈ 1 →
 * opacité ≈ 0 → TOUTES les traînées d'avions actifs devenaient invisibles.
 */
function makeFeature(
  id: string,
  coordinates: GeoJSON.Position[],
  allPoints: TrailPoint[],
  now: number,
  maxAgeMs: number,
): GeoJSON.Feature<GeoJSON.LineString, { id: string; ageRatio: number }> {
  const newest = allPoints[allPoints.length - 1].t;
  const age = now - newest;
  // Clamp dans [0, 1] : 0 = tout frais, 1 = au bord de l'expiration.
  const ageRatio = maxAgeMs > 0 ? Math.max(0, Math.min(1, age / maxAgeMs)) : 0;
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { id, ageRatio },
  };
}

/**
 * Supprime de la couche l'historique des entités qui ne sont plus vivantes
 * (absentes de `aliveIds`). À appeler après chaque fetch pour éviter que le
 * buffer ne fuie sur des mobiles sortis du viewport ou disparus du flux.
 */
export function pruneEntities(layerKey: string, aliveIds: Set<string>): void {
  const layer = buffers.get(layerKey);
  if (!layer) return;
  for (const id of layer.keys()) {
    if (!aliveIds.has(id)) layer.delete(id);
  }
  // Couche entièrement vidée → on retire aussi la couche du buffer racine.
  if (layer.size === 0) buffers.delete(layerKey);
}

/**
 * Vide les traînées : une couche précise si `layerKey` est fourni, sinon
 * TOUT le buffer (reset de session / déconnexion / masquage global).
 */
export function clearTrails(layerKey?: string): void {
  if (layerKey === undefined) {
    buffers.clear();
  } else {
    buffers.delete(layerKey);
  }
}
