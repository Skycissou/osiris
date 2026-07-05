'use client';

// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — LIVE DATA : polling 2-vitesses + ETag/304 + interpolation.
//  Alimente le store par-clé (./store) à partir d'endpoints HTTP internes
//  Next (routes /api/…). Trois flux :
//    • RAPIDE  (défaut /live-feed/fast) toutes les 15 s  → avions, navires…
//    • LENT    (défaut /live-feed/slow) toutes les 120 s → couches lourdes.
//    • CRITIQUE (défaut /api/bootstrap/critical) UNE fois au montage → seed.
//  Optimisations : ETag conditionnel (If-None-Match → 304 = no-op), scoping
//  bbox pour les couches denses, et interpolation dead-reckoning entre fetches
//  pour un rendu fluide des mobiles. Ré-écriture clean-room (aucune copie).
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { mergeData, type StoreData } from './store';
import { keyHeaders } from './apiKeys';

// Clés des couches à source payante/restreinte (FIRMS, AIS, sensibles form-2).
// Envoyées en en-tête x-osiris-key-* si configurées via le module Clés API ;
// le serveur retombe sur l'env si absentes.
const LIVE_KEY_SERVICES = ['firms', 'ais_url', 'ais_key', 'cctv', 'gpsjam', 'scanner', 'sigint', 'telegram'] as const;

// ── basePath ───────────────────────────────────────────────────────────
//  Le cockpit tourne sous /cockpit : les routes /api internes DOIVENT être
//  préfixées par le basePath Next. On lit l'env public (défaut '').
const DEFAULT_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

// ── Bbox viewport ────────────────────────────────────────────────────────
/** Emprise géographique [minLng, minLat, maxLng, maxLat] (ordre GeoJSON). */
export type BBox = [number, number, number, number];

/** Sérialise une bbox en valeur de query `minLng,minLat,maxLng,maxLat`. */
function bboxToParam(bbox: BBox): string {
  return bbox.map((n) => Number(n.toFixed(5))).join(',');
}

// ── Options du hook de polling ────────────────────────────────────────────
export interface DataPollingOptions {
  /** URL de l'endpoint rapide (défaut '/live-feed/fast'). */
  fastUrl?: string;
  /** URL de l'endpoint lent (défaut '/live-feed/slow'). */
  slowUrl?: string;
  /** URL du bootstrap critique, appelé 1 fois au montage (défaut '/api/bootstrap/critical'). */
  criticalUrl?: string;
  /** Intervalle rapide en ms (défaut 15 000). */
  fastIntervalMs?: number;
  /** Intervalle lent en ms (défaut 120 000). */
  slowIntervalMs?: number;
  /** Préfixe de route Next (défaut process.env.NEXT_PUBLIC_BASE_PATH). */
  basePath?: string;
  /** Bbox initiale appliquée aux endpoints denses (rapide + lent). */
  bbox?: BBox;
  /**
   * Clés considérées comme "denses" et scopées par bbox. Les autres (couches
   * de référence : frontières, sismicité globale…) NE sont PAS filtrées.
   * Purement informatif ici : la bbox est passée en query, le backend décide.
   */
  denseEndpoints?: ('fast' | 'slow')[];
  /** Active/désactive tout le polling (défaut true). */
  enabled?: boolean;
}

// IMPORTANT — les routes live vivent SOUS `/live-feed`, PAS sous `/api`.
// En prod/staging, Traefik route `/api/*` vers le FastAPI V3 : une route Next
// sous `/api/...` serait interceptée par le backend (404). Même raison que le
// proxy de tuiles (`/proxy-tiles`). `/live-feed/*` reste servi par Next.
const DEFAULTS = {
  fastUrl: '/live-feed/fast',
  slowUrl: '/live-feed/slow',
  criticalUrl: '/live-feed/critical',
  fastIntervalMs: 15_000,
  slowIntervalMs: 120_000,
  denseEndpoints: ['fast'] as ('fast' | 'slow')[],
} as const;

/** Délai de debounce (ms) avant refetch après un changement de bbox. */
const BBOX_DEBOUNCE_MS = 250;

/** API renvoyée par useDataPolling pour piloter le viewport depuis la carte. */
export interface DataPollingHandle {
  /** Met à jour la bbox viewport → déclenche un refetch debouncé (~250 ms). */
  setBBox: (bbox: BBox) => void;
  /** Force un refetch immédiat des trois flux (rapide + lent + critique déjà fait). */
  refreshNow: () => void;
}

/**
 * Construit une URL absolue-d'origine préfixée par le basePath, avec bbox
 * optionnelle. Les routes /api étant internes à Next, elles VIVENT sous le
 * basePath (contrairement aux appels API externes de api.ts).
 */
function buildLiveUrl(path: string, basePath: string, bbox?: BBox): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  const prefix = basePath.replace(/\/$/, '');
  let url = `${prefix}${clean}`;
  if (bbox) {
    url += `${url.includes('?') ? '&' : '?'}bbox=${encodeURIComponent(bboxToParam(bbox))}`;
  }
  return url;
}

/**
 * Hook de polling 2-vitesses avec ETag. Gère lui-même ses timers et les
 * nettoie au démontage. Renvoie un handle pour piloter la bbox et forcer un
 * refetch. Le corps de chaque réponse 200 est fusionné dans le store par-clé
 * via mergeData() ; un 304 est un no-op (aucun re-merge, aucun re-render).
 *
 * Exemple :
 *   const live = useDataPolling({ bbox: currentViewport });
 *   // sur move de la carte :
 *   map.on('moveend', () => live.setBBox(map.getBounds().toArray().flat() as BBox));
 */
export function useDataPolling(opts: DataPollingOptions = {}): DataPollingHandle {
  const {
    fastUrl = DEFAULTS.fastUrl,
    slowUrl = DEFAULTS.slowUrl,
    criticalUrl = DEFAULTS.criticalUrl,
    fastIntervalMs = DEFAULTS.fastIntervalMs,
    slowIntervalMs = DEFAULTS.slowIntervalMs,
    basePath = DEFAULT_BASE_PATH,
    bbox: initialBBox,
    denseEndpoints = DEFAULTS.denseEndpoints,
    enabled = true,
  } = opts;

  // ── Refs mutables (ne déclenchent PAS de re-render) ──────────────────────
  //  ETag mémorisé PAR endpoint (clé = URL de base sans bbox).
  const etags = useRef<Map<string, string>>(new Map());
  //  Bbox courante, lue dans les ticks sans re-créer les intervalles.
  const bboxRef = useRef<BBox | undefined>(initialBBox);
  //  Timer de debounce du changement de bbox.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  //  Options figées dans des refs pour un fetch stable sans re-déclencher l'effet.
  const cfgRef = useRef({ fastUrl, slowUrl, criticalUrl, basePath, denseEndpoints });
  cfgRef.current = { fastUrl, slowUrl, criticalUrl, basePath, denseEndpoints };

  /**
   * Fetch conditionnel d'un endpoint : pose If-None-Match si un ETag est
   * connu, lit l'ETag de la réponse sur 200 et merge le corps ; no-op sur 304.
   * `useBBox` indique si l'endpoint est scopé par la bbox courante.
   */
  async function fetchEndpoint(path: string, useBBox: boolean): Promise<void> {
    const bbox = useBBox ? bboxRef.current : undefined;
    const url = buildLiveUrl(path, cfgRef.current.basePath, bbox);
    // Clé ETag = chemin logique (sans bbox) : on veut un ETag par ressource,
    // pas par emprise, sinon chaque pan casse le cache conditionnel.
    const etagKey = path;
    const headers: Record<string, string> = { Accept: 'application/json', ...keyHeaders([...LIVE_KEY_SERVICES]) };
    const prev = etags.current.get(etagKey);
    if (prev) headers['If-None-Match'] = prev;

    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers,
      });
      // 304 Not Modified → rien n'a changé côté serveur : on ne re-merge pas.
      if (res.status === 304) return;
      if (!res.ok) {
        console.warn(`[OSIRIS live] ${res.status} ${res.statusText} — ${path}`);
        return;
      }
      const etag = res.headers.get('ETag');
      if (etag) etags.current.set(etagKey, etag);
      const body = (await res.json()) as Partial<StoreData>;
      // Le backend renvoie déjà un objet clé→valeur (couche→données) : merge direct.
      if (body && typeof body === 'object') mergeData(body);
    } catch (e) {
      console.warn('[OSIRIS live] fetch échoué:', e instanceof Error ? e.message : e);
    }
  }

  /** L'endpoint rapide est-il dense (scopé bbox) ? idem lent. */
  function isDense(kind: 'fast' | 'slow'): boolean {
    return cfgRef.current.denseEndpoints.includes(kind);
  }

  // ── Bootstrap critique + boucles de polling ──────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    // 1) Bootstrap critique : une seule fois au montage (seed du store).
    //    Non scopé bbox (données de départ, souvent globales).
    void fetchEndpoint(cfgRef.current.criticalUrl, false);

    // 2) Premier tick immédiat des deux flux, puis intervalles.
    void fetchEndpoint(cfgRef.current.fastUrl, isDense('fast'));
    void fetchEndpoint(cfgRef.current.slowUrl, isDense('slow'));

    const fastTimer = setInterval(() => {
      void fetchEndpoint(cfgRef.current.fastUrl, isDense('fast'));
    }, fastIntervalMs);

    const slowTimer = setInterval(() => {
      void fetchEndpoint(cfgRef.current.slowUrl, isDense('slow'));
    }, slowIntervalMs);

    // Cleanup : on coupe les deux intervalles + un éventuel debounce en vol.
    return () => {
      clearInterval(fastTimer);
      clearInterval(slowTimer);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
    // fetchEndpoint/isDense lisent tout via cfgRef → deps limitées aux valeurs
    // qui doivent RECRÉER les intervalles (fréquences + activation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fastIntervalMs, slowIntervalMs]);

  // ── Handle stable renvoyé à l'appelant ───────────────────────────────────
  const handleRef = useRef<DataPollingHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = {
      setBBox: (bbox: BBox) => {
        bboxRef.current = bbox;
        // Debounce : un pan/zoom continu ne doit pas spammer le réseau.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          // Ne refetch QUE les endpoints denses (ceux qui dépendent de la bbox).
          if (isDense('fast')) void fetchEndpoint(cfgRef.current.fastUrl, true);
          if (isDense('slow')) void fetchEndpoint(cfgRef.current.slowUrl, true);
        }, BBOX_DEBOUNCE_MS);
      },
      refreshNow: () => {
        void fetchEndpoint(cfgRef.current.fastUrl, isDense('fast'));
        void fetchEndpoint(cfgRef.current.slowUrl, isDense('slow'));
      },
    };
  }
  return handleRef.current;
}

// ─────────────────────────────────────────────────────────────────────────
//  INTERPOLATION / DEAD-RECKONING
//  Entre deux fetches (jusqu'à 15 s), un mobile (avion/navire/satellite)
//  doit continuer d'avancer visuellement. On estime sa position à partir de
//  sa dernière position connue + cap + vitesse. Formule volontairement simple
//  (plan tangent local), suffisante à l'échelle d'un viewport et de quelques
//  secondes ; on gère le wrap de longitude (±180°) et le wrap d'angle (360°).
// ─────────────────────────────────────────────────────────────────────────

/** Entité mobile minimale interpolable. */
export interface MovingEntity {
  lat: number; // degrés
  lng: number; // degrés
  /** Cap en degrés (0 = Nord, 90 = Est, sens horaire). */
  heading: number;
  /**
   * Vitesse sol. Unité au choix de l'appelant, exprimée via `speedMps`
   * ci-dessous (on normalise tout en m/s pour la formule).
   */
  speedMps: number;
  [k: string]: unknown;
}

const EARTH_RADIUS_M = 6_371_000; // rayon moyen terrestre
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Ramène un angle en degrés dans [0, 360). */
export function wrapAngle360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Ramène une longitude en degrés dans [-180, 180). */
export function wrapLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Dead-reckoning : renvoie une COPIE de l'entité avancée de `dtSeconds`
 * selon son cap et sa vitesse. Fonction PURE (n'altère pas l'entrée).
 *
 * Modèle : sur un plan tangent local, la distance parcourue est
 *   d = vitesse (m/s) × dt (s).
 * On décompose sur les axes Nord (composante cos(cap)) et Est (sin(cap)),
 * puis on convertit mètres → degrés :
 *   Δlat = (dNord / R) en rad → deg
 *   Δlng = (dEst  / (R·cos(lat))) en rad → deg   (la longitude "rétrécit" vers les pôles)
 * On gère le wrap de longitude ; la latitude est clampée à ±90 (pas de passage
 * au-dessus du pôle dans ce modèle simple). Le heading est renormalisé 360°.
 */
export function deadReckon(entity: MovingEntity, dtSeconds: number): MovingEntity {
  const { lat, lng, heading, speedMps } = entity;
  if (!Number.isFinite(speedMps) || speedMps <= 0 || dtSeconds <= 0) {
    // Immobile ou dt nul : on renvoie une copie inchangée (heading normalisé).
    return { ...entity, heading: wrapAngle360(heading) };
  }
  const distance = speedMps * dtSeconds; // mètres parcourus
  const hdgRad = wrapAngle360(heading) * DEG2RAD;

  const dNorth = distance * Math.cos(hdgRad); // + vers le Nord
  const dEast = distance * Math.sin(hdgRad); // + vers l'Est

  const dLat = (dNorth / EARTH_RADIUS_M) * RAD2DEG;
  // cos(lat) évite la division par ~0 près des pôles via un plancher.
  const cosLat = Math.max(Math.cos(lat * DEG2RAD), 1e-6);
  const dLng = (dEast / (EARTH_RADIUS_M * cosLat)) * RAD2DEG;

  const newLat = Math.max(-90, Math.min(90, lat + dLat));
  const newLng = wrapLongitude(lng + dLng);

  return { ...entity, lat: newLat, lng: newLng, heading: wrapAngle360(heading) };
}

/** Options du hook d'interpolation. */
export interface InterpolationOptions {
  /** Période du tick en ms (défaut 2 000). */
  tickMs?: number;
  /** Active/désactive le tick (défaut true). */
  enabled?: boolean;
}

/**
 * Hook d'interpolation : appelle `onTick(dtSeconds)` à intervalle régulier
 * (défaut 2 s) en fournissant le temps ÉCOULÉ depuis le tick précédent. À
 * l'intérieur de onTick, l'appelant applique deadReckon() à ses mobiles et
 * pousse les positions estimées (ex. vers un layer MapLibre, ou mergeData()).
 * Le hook ne connaît AUCUNE couche : il ne fait que cadencer.
 *
 * Nettoie son interval au démontage / changement d'options.
 *
 * Exemple :
 *   useInterpolation((dt) => {
 *     const avions = getSnapshotKey<MovingEntity[]>('aircraft') ?? [];
 *     const estimes = avions.map((a) => deadReckon(a, dt));
 *     mergeData({ aircraft_interp: estimes }); // couche d'affichage lissée
 *   });
 */
export function useInterpolation(
  onTick: (dtSeconds: number) => void,
  options: InterpolationOptions = {},
): void {
  const { tickMs = 2_000, enabled = true } = options;
  // Callback dans une ref : on met à jour sans recréer l'interval.
  const cbRef = useRef(onTick);
  cbRef.current = onTick;
  // Horodatage du dernier tick pour calculer dt réel (robuste au jitter/throttle).
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    lastRef.current = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastRef.current) / 1000; // secondes réellement écoulées
      lastRef.current = now;
      if (dt > 0) cbRef.current(dt);
    }, tickMs);
    // Cleanup : coupe le tick au démontage ou si tickMs/enabled changent.
    return () => clearInterval(timer);
  }, [tickMs, enabled]);
}
