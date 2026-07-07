'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASE_PATH } from '@/lib/api';
// (pruneEntities volontairement plus importé — cf. notes 07/07 sur les traînées)
import { recordPositions, buildTrails } from '@/lib/trails';

// ─────────────────────────────────────────────────────────────────────────
//  OsirisMap — CHÂSSIS carto MapLibre (OSIRIS V4 LEAN)
//  Fournit uniquement la base cartographique + les helpers de rendu.
//  Les couches de données FR (Entreprises, BODACC, DVF, BAN, RNA…) seront
//  câblées ici quand le backend FastAPI sera dispo — voir le gabarit commenté
//  plus bas (`useEffect(setGeo(...))`).
// ─────────────────────────────────────────────────────────────────────────

/** Avion temps réel normalisé (source adsb.lol, données publiques ADS-B). */
export interface AircraftPoint {
  id: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  alt?: number;
  callsign?: string;
  hex?: string;
  category?: string;
  reg?: string;
  acType?: string;
  mil?: boolean;
  /** Marqueur watchlist VIP (forme 2, données publiques) — cf. route fast. */
  vip?: boolean;
  vipName?: string;
  /** Catégorie VIP ('gouvernement'|'dirigeant'|'militaire') — champ dédié (≠ `category` ADS-B). */
  vipCategory?: string;
  vipColor?: string;
}

/** Séisme normalisé (source USGS GeoJSON, public). */
export interface QuakePoint {
  id: string;
  lat: number;
  lng: number;
  mag: number;
  depth?: number;
  place?: string;
  time?: number;
}

/** Foyer d'incendie (source NASA FIRMS, public). */
export interface FirePoint {
  id: string;
  lat: number;
  lng: number;
  bright?: number;
  time?: string | number;
}

/** Volcan (stub — piste Smithsonian GVP). */
export interface VolcanoPoint {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  status?: string;
}

/** Satellite (source celestrak TLE + calcul SGP4, public). */
export interface SatellitePoint {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  alt?: number;
}

/** Événement géopolitique géolocalisé (source GDELT, public). */
export interface GeoEventPoint {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  name?: string;
  tone?: number;
  count?: number;
  url?: string;
}

/** Serveur C2 malware (source abuse.ch Feodo, public — veille cyber défensive). */
export interface CyberPoint {
  id: string;
  lat: number;
  lng: number;
  ip: string;
  malware?: string;
  country?: string;
  first_seen?: string;
}

/** Navire (source AIS, clé requise — cf. route fast). */
export interface ShipPoint {
  id: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  name?: string;
  type?: string;
  mmsi?: string;
}

/** Point de couche sensible (forme 2) — générique. cctv porte un streamUrl. */
export interface SensitivePoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  name?: string;
  streamUrl?: string;
  type?: string;
  intensity?: number;
}

/** Dictionnaire des couches sensibles (clé → points) — cf. route /live-feed/sensitive. */
export type SensitiveData = Partial<Record<
  'cctv' | 'gps_jamming' | 'scanners' | 'sigint' | 'military_bases' | 'telegram_osint',
  SensitivePoint[]
>>;

// Registre des couches sensibles rendues : clé activeLayers, clé données, couleur, flux.
const SENSITIVE_MAP_LAYERS: { toggle: string; dataKey: keyof SensitiveData; color: string; stream?: boolean }[] = [
  { toggle: 'sens_military_bases', dataKey: 'military_bases', color: '#d6a445' },
  { toggle: 'sens_cctv', dataKey: 'cctv', color: '#db6f78', stream: true },
  { toggle: 'sens_gps_jamming', dataKey: 'gps_jamming', color: '#f0a020' },
  { toggle: 'sens_scanners', dataKey: 'scanners', color: '#9a8cef' },
  { toggle: 'sens_sigint', dataKey: 'sigint', color: '#54bdde' },
  { toggle: 'sens_telegram_osint', dataKey: 'telegram_osint', color: '#9bdcf0' },
];

interface OsirisMapProps {
  /** Données brutes issues du backend FR (clés à définir couche par couche). */
  data?: Record<string, any>;
  /** Etat des couches actives (clés FR stub — cf. LayerPanel). */
  activeLayers: Record<string, boolean>;
  /** Avions temps réel (adsb.lol) — rendus si activeLayers.live_aircraft. */
  aircraft?: AircraftPoint[];
  /** Séismes (USGS) — rendus si activeLayers.live_earthquakes. */
  earthquakes?: QuakePoint[];
  /** Foyers d'incendie (NASA FIRMS) — rendus si activeLayers.live_wildfires. */
  wildfires?: FirePoint[];
  /** Volcans (stub) — rendus si activeLayers.live_volcanoes. */
  volcanoes?: VolcanoPoint[];
  /** Satellites (celestrak + SGP4) — rendus si activeLayers.live_satellites. */
  satellites?: SatellitePoint[];
  /** Navires (AIS) — rendus si activeLayers.live_ships. */
  ships?: ShipPoint[];
  /** Événements géopolitiques (GDELT) — rendus si activeLayers.live_gdelt. */
  gdelt?: GeoEventPoint[];
  /** Serveurs C2 malware (abuse.ch) — rendus si activeLayers.live_cyber. */
  cyber?: CyberPoint[];
  /** Couches sensibles (forme 2) — rendues si activeLayers.sens_* + consentement. */
  sensitive?: SensitiveData;
  /** Clic sur un avion → ouvre la carte-fiche riche (photo + détails). */
  onAircraftClick?: (a: AircraftPoint) => void;
  /** Hex de l'avion sélectionné : SA traînée est dessinée (+ celles des VIP).
   *  null = seules les traînées VIP (politique « app de référence »). */
  selectedAircraftHex?: string | null;
  /** Clic sur une caméra/webcam (cctv) portant un streamUrl → ouvre le lecteur de flux. */
  onStreamClick?: (s: { label: string; streamUrl: string; lat?: number; lng?: number }) => void;
  onEntityClick?: (entity: any) => void;
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  onViewStateChange?: (vs: { zoom: number; latitude: number }) => void;
  /** Emprise visible [minLng,minLat,maxLng,maxLat] — émise au chargement puis à
   *  chaque fin de déplacement. Branchée sur live.setBBox : les couches denses
   *  (avions…) suivent la carte au lieu de rester figées sur la France. */
  onBoundsChange?: (bbox: [number, number, number, number]) => void;
  flyToLocation?: { lat: number; lng: number; ts: number } | null;
  projection?: 'mercator' | 'globe';
  /** Fond : 'dark' (CARTO) · 'satellite' (ArcGIS) · 'ign' (Plan IGN) · 'scan25' · 'ortho' (ortho IGN). */
  mapStyle?: string;
  /**
   * Couche « remonter le temps » active (un seul, empilée AU-DESSUS du fond).
   * 'none' = aucune · 'ortho-year' = ortho annuelle pilotée par `orthoYear`
   * · sinon clé de TIME_LAYERS (décennies N&B / cartes anciennes).
   */
  timeLayer?: string;
  /** Année choisie pour l'ortho annuelle (utilisée seulement si timeLayer === 'ortho-year'). */
  orthoYear?: number;
  /** Surcouches thématiques IGN cochables (plusieurs simultanées) — clé → actif. */
  overlays?: Record<string, boolean>;
}

// Terminateur solaire jour/nuit (couche optionnelle) — géométrie polygonale.
function computeSolarTerminator(): [number, number][] {
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const decRad = declination * Math.PI / 180;
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const subsolarLng = (12 - utcHours) * 15;
  const points: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const lngRad = (lng - subsolarLng) * Math.PI / 180;
    const lat = Math.atan(-Math.cos(lngRad) / Math.tan(decRad)) * 180 / Math.PI;
    points.push([lng, lat]);
  }
  const darkSide = declination >= 0 ? -90 : 90;
  points.push([180, darkSide]);
  points.push([-180, darkSide]);
  points.push(points[0]);
  return points;
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

// ── Couleur des avions PAR CATÉGORIE (demande Cissou 07/07 : « tout est bleu ») ──
//  Buckets dérivés de la catégorie émetteur ADS-B (A1..A7) + bit militaire.
//  Une icône « plane-<key> » est générée par couleur au chargement de la carte.
export const AIRCRAFT_CAT_COLORS: Record<string, string> = {
  mil: '#e0555f', // militaire (bit dbFlags) — rouge
  heavy: '#f0a35e', // gros porteur (A5) — orange
  large: '#c9a2ff', // large (A3/A4) — violet clair
  rotor: '#7cffb2', // hélicoptère / giravion (A7) — vert
  light: '#9bdcf0', // léger / petit (A1/A2) — cyan
  default: '#8fa6bd', // autre / inconnu — gris-bleu
};
/** Libellés FR pour la légende. */
export const AIRCRAFT_CAT_LABELS: Record<string, string> = {
  mil: 'Militaire',
  heavy: 'Gros porteur',
  large: 'Grand avion',
  rotor: 'Hélicoptère',
  light: 'Avion léger',
  default: 'Autre / inconnu',
};

/** Catégorie émetteur ADS-B + bit militaire → clé de couleur/icône. */
function aircraftCatKey(category?: string, mil?: boolean): string {
  if (mil) return 'mil';
  const c = (category ?? '').toUpperCase();
  if (c === 'A5') return 'heavy';
  if (c === 'A3' || c === 'A4') return 'large';
  if (c === 'A7') return 'rotor';
  if (c === 'A1' || c === 'A2') return 'light';
  return 'default';
}

// ── Fabrique d'URL de tuiles WMTS Géoplateforme IGN (data.geopf.fr) ──
// Gratuit sans clé · TileMatrixSet PM = z/x/y standard (compatible MapLibre).
const wmts = (layer: string, format: string) =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}` +
  `&STYLE=normal&FORMAT=${format}&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

// ── Fonds raster empilables (satellite ArcGIS + fonds IGN modernes) ──
// Chaque fond = un calque raster inséré SOUS les points/historique. Un seul
// visible selon `mapStyle` ; 'dark' = aucun (CARTO seul).
const RASTER_BASES: Record<string, { tiles: string; tileSize: number; minzoom: number; maxzoom: number; opacity: number }> = {
  satellite: {
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    tileSize: 256, minzoom: 0, maxzoom: 18, opacity: 0.85,
  },
  ign: { tiles: wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), tileSize: 256, minzoom: 0, maxzoom: 19, opacity: 1 },
  scan25: { tiles: wmts('GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR', 'image/jpeg'), tileSize: 256, minzoom: 0, maxzoom: 16, opacity: 1 },
  ortho: { tiles: wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), tileSize: 256, minzoom: 0, maxzoom: 19, opacity: 1 },
};

// ── Couches « REMONTER LE TEMPS » à identifiant FIXE — empilées AU-DESSUS du fond ──
// Un seul visible à la fois ; l'ortho annuelle (identifiant dynamique) est gérée
// à part (cf. effet time-layer). minzoom/maxzoom VÉRIFIÉS au GetCapabilities.
const TIME_LAYERS: Record<string, { tiles: string; minzoom: number; maxzoom: number }> = {
  ortho1950: { tiles: wmts('ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', 'image/png'), minzoom: 0, maxzoom: 18 },
  ortho1965: { tiles: wmts('ORTHOIMAGERY.ORTHOPHOTOS.1965-1980', 'image/png'), minzoom: 3, maxzoom: 18 },
  ortho1980: { tiles: wmts('ORTHOIMAGERY.ORTHOPHOTOS.1980-1995', 'image/png'), minzoom: 3, maxzoom: 18 },
  scan50: { tiles: wmts('GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950', 'image/jpeg'), minzoom: 3, maxzoom: 15 },
  etatmajor: { tiles: wmts('GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40', 'image/jpeg'), minzoom: 6, maxzoom: 15 },
};

// ── SURCOUCHES thématiques IGN (checkboxes, plusieurs simultanées) ──
// Empilées AU-DESSUS de la couche temps, SOUS les points de données.
// minzoom/maxzoom/format VÉRIFIÉS au GetCapabilities → jamais de tuiles hors plage.
const OVERLAYS: Record<string, { tiles: string; minzoom: number; maxzoom: number; opacity: number }> = {
  cadastre:  { tiles: wmts('CADASTRALPARCELS.PARCELLAIRE_EXPRESS', 'image/png'), minzoom: 0, maxzoom: 19, opacity: 0.7 },
  rpg:       { tiles: wmts('LANDUSE.AGRICULTURE.LATEST', 'image/png'), minzoom: 6, maxzoom: 16, opacity: 0.7 },
  forets:    { tiles: wmts('FORETS.PUBLIQUES', 'image/png'), minzoom: 3, maxzoom: 16, opacity: 0.7 },
  protected: { tiles: wmts('PROTECTEDAREAS.PRSF', 'image/png'), minzoom: 6, maxzoom: 17, opacity: 0.6 },
  pentes:    { tiles: wmts('ELEVATION.SLOPES', 'image/jpeg'), minzoom: 6, maxzoom: 14, opacity: 0.5 },
  irc:       { tiles: wmts('ORTHOIMAGERY.ORTHOPHOTOS.IRC', 'image/jpeg'), minzoom: 6, maxzoom: 19, opacity: 1 },
  hydro:     { tiles: wmts('HYDROGRAPHY.HYDROGRAPHY', 'image/png'), minzoom: 6, maxzoom: 18, opacity: 0.8 },
  routes:    { tiles: wmts('TRANSPORTNETWORKS.ROADS', 'image/png'), minzoom: 6, maxzoom: 18, opacity: 0.8 },
  rail:      { tiles: wmts('TRANSPORTNETWORKS.RAILWAYS', 'image/png'), minzoom: 6, maxzoom: 18, opacity: 0.9 },
  admin:     { tiles: wmts('ADMINEXPRESS-COG-CARTO.LATEST', 'image/png'), minzoom: 6, maxzoom: 16, opacity: 0.7 },
  noms:      { tiles: wmts('GEOGRAPHICALNAMES.NAMES', 'image/png'), minzoom: 6, maxzoom: 18, opacity: 1 },
};

// Ordre de peinture STABLE des surcouches (bas → haut) : imagerie/zones d'abord,
// réseaux ensuite, toponymes tout en haut (toujours lisibles).
const OVERLAY_ORDER = Object.keys(OVERLAYS);
const ID_TIME_LAYER = 'time-layer';

// Ids MapLibre des rasters, du plus bas au plus haut.
const MODERN_BASE_IDS = Object.keys(RASTER_BASES).map((k) => `base-${k}`);

// ── Garant de l'ORDRE DE PEINTURE des rasters (bas → haut) ──
// fond moderne < couche temps < surcouches < [day-night-fill] < points de données.
// On déplace chaque raster juste SOUS la 1ʳᵉ couche de données (day-night-fill),
// dans l'ordre voulu : le dernier déplacé finit le plus haut (juste sous l'ancre).
function restackRasters(map: maplibregl.Map) {
  const anchor = map.getLayer('day-night-fill')
    ? 'day-night-fill'
    : FR_LAYERS.map((l) => l.layer).find((id) => map.getLayer(id));
  if (!anchor) return;
  const order = [...MODERN_BASE_IDS, ID_TIME_LAYER, ...OVERLAY_ORDER.map((k) => `ov-${k}`)];
  for (const id of order) {
    if (map.getLayer(id)) {
      try { map.moveLayer(id, anchor); } catch { /* couche absente/ordre déjà bon */ }
    }
  }
}

// Centre par défaut : France métropolitaine.
const DEFAULT_CENTER: [number, number] = [2.35, 46.6];
const DEFAULT_ZOOM = 5.2;

// ── Couches de résultats FR (search-first) ──
// clé = toggle sidebar (activeLayers) ; src/layer = ids MapLibre ; color = pastille.
// data[key] doit être un tableau de points { lat, lng, card } (cf. api.buildMapData).
const FR_LAYERS: { key: string; src: string; layer: string; color: string; label: string }[] = [
  { key: 'fr_entreprises', src: 'fr-entreprises', layer: 'fr-entreprises-dots', color: '#54bdde', label: 'Entreprise' },
  { key: 'fr_bodacc', src: 'fr-bodacc', layer: 'fr-bodacc-dots', color: '#db6f78', label: 'BODACC' },
  { key: 'fr_dvf', src: 'fr-dvf', layer: 'fr-dvf-dots', color: '#9bdcf0', label: 'Valeur foncière' },
  { key: 'fr_ban', src: 'fr-ban', layer: 'fr-ban-dots', color: '#9a8cef', label: 'Adresse (BAN)' },
  { key: 'fr_rna', src: 'fr-rna', layer: 'fr-rna-dots', color: '#5bc78d', label: 'Association' },
];

// Style inline des popups FR (aligné sur le popup helper du châssis).
const POPUP_STYLE =
  "background:rgba(13,18,27,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'IBM Plex Mono',monospace;";

// Point plotté minimal attendu dans data[fr_*] (cf. api.PlotPoint).
interface FrPlotRow {
  lat: number;
  lng: number;
  card?: {
    title?: string;
    subtitle?: string;
    summary?: string;
    source_label?: string;
  };
}

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function OsirisMap({
  data = {},
  activeLayers,
  aircraft = [],
  earthquakes = [],
  wildfires = [],
  volcanoes = [],
  satellites = [],
  ships = [],
  gdelt = [],
  cyber = [],
  sensitive = {},
  onAircraftClick,
  selectedAircraftHex = null,
  onStreamClick,
  onEntityClick,
  onMouseCoords,
  onRightClick,
  onViewStateChange,
  onBoundsChange,
  flyToLocation,
  projection = 'mercator',
  mapStyle = 'dark',
  timeLayer = 'none',
  orthoYear = 2021,
  overlays = {},
}: OsirisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const prevStyleRef = useRef(mapStyle);
  // Ref sur onEntityClick : les handlers de clic sont posés une seule fois au
  // chargement, la ref évite de capturer une prop périmée (MAJ hors render).
  const onEntityClickRef = useRef(onEntityClick);
  useEffect(() => { onEntityClickRef.current = onEntityClick; }, [onEntityClick]);
  const onAircraftClickRef = useRef(onAircraftClick);
  useEffect(() => { onAircraftClickRef.current = onAircraftClick; }, [onAircraftClick]);
  const onStreamClickRef = useRef(onStreamClick);
  useEffect(() => { onStreamClickRef.current = onStreamClick; }, [onStreamClick]);

  // ── Générateur d'icône "avion" sur canvas (gabarit symbole WebGL) ──
  //  Refaite le 07/07 (retour Cissou « logos Atari ») : vraie silhouette
  //  d'avion de ligne vue de dessus (fuselage effilé + ailes en flèche +
  //  empennage), tracée en Path2D, rendue en 2× (pixelRatio) → anticrénelée,
  //  avec liseré sombre (lisible sur fond satellite clair) + léger halo.
  const createIcon = useCallback((map: maplibregl.Map, id: string, color: string, size: number) => {
    if (map.hasImage(id)) return;
    const scale = 2; // rendu 2× → net sur écrans denses
    const px = size * scale;
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    // Silhouette dessinée dans un espace 64×64 (nez vers le haut), remise à
    // l'échelle du canvas. Tracé clean-room (aucun glyphe copié).
    const p = new Path2D(
      'M32 3 C34 3 35.4 5.2 35.8 8.6 L36.3 21.5 L60.5 33.5 L60.5 38.2 L36.4 31.2 ' +
      'L35.8 45.6 L44.2 52 L44.2 55.6 L32 52.4 L19.8 55.6 L19.8 52 L28.2 45.6 ' +
      'L27.6 31.2 L3.5 38.2 L3.5 33.5 L27.7 21.5 L28.2 8.6 C28.6 5.2 30 3 32 3 Z',
    );
    ctx.setTransform(px / 64, 0, 0, px / 64, 0, 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0a1016';
    ctx.lineWidth = 2.5;
    ctx.stroke(p);
    ctx.fillStyle = color;
    ctx.fill(p);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    map.addImage(
      id,
      { width: px, height: px, data: new Uint8Array(ctx.getImageData(0, 0, px, px).data) },
      { pixelRatio: scale },
    );
  }, []);

  // ── Générateur de pastille ronde sur canvas ──
  const createDot = useCallback((map: maplibregl.Map, id: string, color: string, size: number) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    map.addImage(id, { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
  }, []);

  // ── INIT MAP (une seule fois) ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const styleUrl = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, minZoom: 1.5, maxZoom: 18,
      attributionControl: false,
      maxPitch: 85,
      transformRequest: (url: string) => {
        // Requêtes CARTO CDN → proxy interne Next.js `/proxy-tiles`.
        // NB: PAS sous `/api` — en prod, Traefik route `/api/*` vers le FastAPI ;
        // le proxy de tuiles doit rester servi par le front Next.
        // ⚠️ Sous basePath (/cockpit), la route Next vit à `/cockpit/proxy-tiles` :
        // on préfixe BASE_PATH (source unique), sinon carte noire (proxy en 404).
        if (url.includes('cartocdn.com')) {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
          return { url: `${baseUrl}${BASE_PATH}/proxy-tiles?url=${encodeURIComponent(url)}` };
        }
        return { url };
      },
    });

    map.on('load', () => {
      mapRef.current = map;

      // Barre d'échelle (confort de lecture des distances) — coin bas-droit,
      // unités métriques. Contrôle natif MapLibre, stylé par globals.css.
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');

      // Icônes/pastilles de base réutilisables par les futures couches FR.
      // Une icône par catégorie d'avion (couleur) — demande Cissou 07/07.
      createIcon(map, 'plane', '#9bdcf0', 26); // défaut / inconnu (rétro-compat)
      for (const [key, col] of Object.entries(AIRCRAFT_CAT_COLORS)) {
        createIcon(map, `plane-${key}`, col, 26);
      }
      createDot(map, 'dot-gold', '#54bdde', 8);

      // Source jour/nuit (couche d'affichage optionnelle conservée).
      map.addSource('day-night', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({ id: 'day-night-fill', type: 'fill', source: 'day-night', paint: { 'fill-color': '#000022', 'fill-opacity': 0.35 } });

      // ─── COUCHES DE RÉSULTATS FR (search-first) ───────────────────────
      // 1 source geojson + 1 couche circle par type de résultat. Alimentées
      // plus bas par useEffect(setGeo(...)) à partir de `data` (points plottés).
      FR_LAYERS.forEach(({ src, layer, color }) => {
        map.addSource(src, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({
          id: layer,
          type: 'circle',
          source: src,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 9],
            'circle-color': color,
            'circle-opacity': 0.85,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#070a0f',
          },
          layout: { visibility: 'none' },
        });

        // Popup au clic : label + type + infos clés de la carte.
        map.on('click', layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties || {};
          const geom = f.geometry;
          const coords = geom && geom.type === 'Point'
            ? (geom.coordinates as [number, number])
            : [e.lngLat.lng, e.lngLat.lat];
          const summary = String(p.summary || '').split('\n').map(escapeHtml).join('<br>');
          const html =
            `<div style="${POPUP_STYLE}">` +
            `<div style="color:${color};font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">${escapeHtml(p.typeLabel)}</div>` +
            `<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(p.title)}</div>` +
            (p.subtitle ? `<div style="color:#7f8da1;font-size:11px;margin-bottom:6px;">${escapeHtml(p.subtitle)}</div>` : '') +
            (summary ? `<div style="color:#c2cbd8;font-size:12px;line-height:1.5;">${summary}</div>` : '') +
            `<div style="color:#586475;font-size:10px;margin-top:8px;">${escapeHtml(p.source)}</div>` +
            `</div>`;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 })
            .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
          onEntityClickRef.current?.(p);
        });
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      });
      // ──────────────────────────────────────────────────────────────────

      // ─── COUCHE TEMPS RÉEL : AVIONS (adsb.lol, données publiques ADS-B) ──
      // Symboles "avion" orientés par le cap. Alimentée par la prop `aircraft`
      // (polling 15 s + interpolation), affichée si activeLayers.live_aircraft.
      map.addSource('live-aircraft', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-aircraft-symbols',
        type: 'symbol',
        source: 'live-aircraft',
        layout: {
          // Icône colorée par catégorie : la feature porte `iconId`
          // (plane-mil / plane-heavy / …) sinon retombe sur 'plane' (défaut).
          'icon-image': ['coalesce', ['get', 'iconId'], 'plane'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.1],
          'icon-rotate': ['coalesce', ['get', 'heading'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          visibility: 'none',
        },
      });
      // Clic avion → ouvre la carte-fiche riche (photo + détails) via le parent.
      map.on('click', 'live-aircraft-symbols', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point'
          ? (geom.coordinates as [number, number])
          : [e.lngLat.lng, e.lngLat.lat];
        const num = (v: unknown) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
        onAircraftClickRef.current?.({
          id: String(p.hex || p.id || ''),
          lat: coords[1], lng: coords[0],
          heading: num(p.heading), speed: num(p.speed), alt: num(p.alt),
          callsign: p.callsign ? String(p.callsign) : undefined,
          hex: p.hex ? String(p.hex) : undefined,
          category: p.category ? String(p.category) : undefined,
          reg: p.reg ? String(p.reg) : undefined,
          acType: p.acType ? String(p.acType) : undefined,
          vip: p.vip === true || p.vip === 'true',
          vipName: p.vipName ? String(p.vipName) : undefined,
          vipCategory: p.vipCategory ? String(p.vipCategory) : undefined,
          vipColor: p.vipColor ? String(p.vipColor) : undefined,
        });
      });
      map.on('mouseenter', 'live-aircraft-symbols', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-aircraft-symbols', () => { map.getCanvas().style.cursor = ''; });

      // Halo VIP : cercle coloré SOUS le symbole avion pour les aéronefs taggés
      // vip=true (forme 2). Couleur = vipColor (charte V3). Ajouté AVANT la
      // couche symbole pour passer dessous ; alimenté par la même source filtrée.
      map.addSource('live-aircraft-vip', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-aircraft-vip-halo',
        type: 'circle',
        source: 'live-aircraft-vip',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 8, 10, 16],
          'circle-color': ['coalesce', ['get', 'vipColor'], '#9a8cef'],
          'circle-opacity': 0.28,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': ['coalesce', ['get', 'vipColor'], '#9a8cef'],
          'circle-stroke-opacity': 0.7,
        },
        layout: { visibility: 'none' },
      }, 'live-aircraft-symbols');

      // ─── COUCHE SÉISMES (USGS, public) ──────────────────────────────────
      // Cercle dont le rayon croît avec la magnitude, couleur par magnitude
      // (≥6 rouge, ≥5 ambre, sinon accent). Popup FR.
      map.addSource('live-quakes', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-quakes-dots',
        type: 'circle',
        source: 'live-quakes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 1, 3, 5, 10, 8, 24],
          'circle-color': ['step', ['get', 'mag'], '#54bdde', 5, '#d6a445', 6, '#db6f78'],
          'circle-opacity': 0.55,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#070a0f',
        },
        layout: { visibility: 'none' },
      });
      map.on('click', 'live-quakes-dots', (e) => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point' ? (geom.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        const depth = p.depth != null && p.depth !== '' ? `${escapeHtml(p.depth)} km` : '—';
        const html =
          `<div style="${POPUP_STYLE}">` +
          `<div style="color:#d6a445;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Séisme · temps réel</div>` +
          `<div style="color:#fff;font-size:16px;font-weight:600;margin-bottom:4px;">M ${escapeHtml(p.mag)}</div>` +
          `<div style="color:#c2cbd8;font-size:12px;line-height:1.6;">${escapeHtml(p.place || 'Lieu inconnu')}<br>Profondeur : ${depth}</div>` +
          `<div style="color:#586475;font-size:10px;margin-top:8px;">source USGS (public)</div>` +
          `</div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '360px', offset: 14 })
          .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'live-quakes-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-quakes-dots', () => { map.getCanvas().style.cursor = ''; });

      // ─── COUCHE FEUX (NASA FIRMS, public — vide sans clé FIRMS_MAP_KEY) ──
      map.addSource('live-fires', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-fires-dots',
        type: 'circle',
        source: 'live-fires',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 10, 6],
          'circle-color': '#db6f78',
          'circle-opacity': 0.7,
          'circle-blur': 0.3,
        },
        layout: { visibility: 'none' },
      });

      // ─── COUCHE VOLCANS (stub — violet) ─────────────────────────────────
      map.addSource('live-volcanoes', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-volcanoes-dots',
        type: 'circle',
        source: 'live-volcanoes',
        paint: {
          'circle-radius': 6,
          'circle-color': '#9a8cef',
          'circle-opacity': 0.8,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#070a0f',
        },
        layout: { visibility: 'none' },
      });

      // ─── COUCHE SATELLITES (celestrak + SGP4, public) ───────────────────
      // Point accent-clair + halo, popup FR (nom + altitude km).
      map.addSource('live-satellites', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-satellites-dots',
        type: 'circle',
        source: 'live-satellites',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 6],
          'circle-color': '#9bdcf0',
          'circle-opacity': 0.9,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#54bdde',
          'circle-stroke-opacity': 0.5,
        },
        layout: { visibility: 'none' },
      });
      map.on('click', 'live-satellites-dots', (e) => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point' ? (geom.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        const alt = p.alt != null && p.alt !== '' ? `${escapeHtml(p.alt)} km` : '—';
        const html =
          `<div style="${POPUP_STYLE}">` +
          `<div style="color:#9bdcf0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Satellite · temps réel</div>` +
          `<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(p.name || 'Inconnu')}</div>` +
          `<div style="color:#c2cbd8;font-size:12px;line-height:1.6;">Altitude : ${alt}</div>` +
          `<div style="color:#586475;font-size:10px;margin-top:8px;">NORAD ${escapeHtml(p.id || '—')} · source celestrak (public)</div>` +
          `</div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '340px', offset: 14 })
          .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'live-satellites-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-satellites-dots', () => { map.getCanvas().style.cursor = ''; });
      // ──────────────────────────────────────────────────────────────────

      // ─── TRAÎNÉES (routes tracées) avions + navires ─────────────────────
      // Ligne dont l'opacité décroît avec l'âge (ageRatio), SOUS les symboles.
      (['aircraft', 'ships'] as const).forEach((k) => {
        map.addSource(`${k}-trails`, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({
          id: `${k}-trails-line`,
          type: 'line',
          source: `${k}-trails`,
          layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
          paint: {
            'line-color': k === 'aircraft' ? '#9bdcf0' : '#54bdde',
            'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 10, 2.4],
            // ageRatio ≈ 0 tant que l'entité émet (cf. trails.ts) → traînée
            // visible en continu ; fondu seulement après disparition du flux.
            'line-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'ageRatio'], 0], 0, 0.75, 1, 0.0],
          },
        });
      });

      // ─── COUCHE NAVIRES (AIS — clé requise, [] sinon) ───────────────────
      map.addSource('live-ships', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-ships-dots',
        type: 'circle',
        source: 'live-ships',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 12, 7],
          'circle-color': '#54bdde',
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#070a0f',
        },
        layout: { visibility: 'none' },
      });
      map.on('click', 'live-ships-dots', (e) => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point' ? (geom.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        const spd = p.speed != null && p.speed !== '' ? `${escapeHtml(p.speed)} nds` : '—';
        const html =
          `<div style="${POPUP_STYLE}">` +
          `<div style="color:#54bdde;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Navire · AIS</div>` +
          `<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(p.name || p.mmsi || 'Inconnu')}</div>` +
          `<div style="color:#c2cbd8;font-size:12px;line-height:1.6;">Type : ${escapeHtml(p.type || '—')}<br>Vitesse : ${spd}</div>` +
          `<div style="color:#586475;font-size:10px;margin-top:8px;">MMSI ${escapeHtml(p.mmsi || '—')} · AIS public</div>` +
          `</div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '340px', offset: 14 })
          .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'live-ships-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-ships-dots', () => { map.getCanvas().style.cursor = ''; });

      // ─── COUCHES SENSIBLES (forme 2 — cctv/jamming/scanners/sigint/bases…) ─
      // Une couche circle par famille. cctv : clic → lecteur de flux in-app.
      SENSITIVE_MAP_LAYERS.forEach(({ dataKey, color, stream }) => {
        const src = `sens-${dataKey}`;
        const layer = `sens-${dataKey}-dots`;
        map.addSource(src, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({
          id: layer,
          type: 'circle',
          source: src,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 12, 7],
            'circle-color': color,
            'circle-opacity': 0.85,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#070a0f',
          },
          layout: { visibility: 'none' },
        });
        map.on('click', layer, (e) => {
          const f = e.features?.[0]; if (!f) return;
          const p = f.properties || {};
          const geom = f.geometry;
          const coords = geom && geom.type === 'Point' ? (geom.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
          // cctv avec flux → lecteur in-app (webcam en direct dans le cockpit).
          if (stream && p.streamUrl) {
            onStreamClickRef.current?.({ label: String(p.label || p.name || 'Caméra'), streamUrl: String(p.streamUrl), lat: coords[1], lng: coords[0] });
            return;
          }
          const html =
            `<div style="${POPUP_STYLE}">` +
            `<div style="color:${color};font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">${escapeHtml(String(dataKey).replace('_', ' '))} · forme 2</div>` +
            `<div style="color:#fff;font-size:13px;font-weight:600;">${escapeHtml(p.label || p.name || p.id || '—')}</div>` +
            `<div style="color:#586475;font-size:10px;margin-top:8px;">données publiques · usage veille (ARPD)</div>` +
            `</div>`;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 14 })
            .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
        });
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      });
      // ──────────────────────────────────────────────────────────────────

      // ─── COUCHE GÉOPOLITIQUE (GDELT) — couleur par tonalité ─────────────
      map.addSource('live-gdelt', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-gdelt-dots',
        type: 'circle',
        source: 'live-gdelt',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 8, 7],
          // tonalité GDELT : très négatif → rouge, positif → vert, sinon ambre.
          'circle-color': ['step', ['coalesce', ['get', 'tone'], 0], '#db6f78', -2, '#d6a445', 2, '#5bc78d'],
          'circle-opacity': 0.6,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#070a0f',
        },
        layout: { visibility: 'none' },
      });
      map.on('click', 'live-gdelt-dots', (e) => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point' ? (geom.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        // 🔒 Sécurité : n'accepter que http(s) pour le href (escapeHtml ne bloque
        //    pas le schéma → un `javascript:` survivrait). URL non http(s) → pas de lien.
        const safeUrl = typeof p.url === 'string' && /^https?:\/\//i.test(p.url) ? p.url : '';
        const link = safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener" style="color:#54bdde;">ouvrir la source ↗</a>` : '';
        const html =
          `<div style="${POPUP_STYLE}">` +
          `<div style="color:#d6a445;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Événement · GDELT</div>` +
          `<div style="color:#fff;font-size:13px;font-weight:600;line-height:1.4;margin-bottom:6px;">${escapeHtml(p.title || p.name || 'Événement')}</div>` +
          `<div style="color:#586475;font-size:10px;">Tonalité : ${escapeHtml(p.tone ?? '—')} · ${link} · source GDELT (public)</div>` +
          `</div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '360px', offset: 14 })
          .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'live-gdelt-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-gdelt-dots', () => { map.getCanvas().style.cursor = ''; });

      // ─── COUCHE CYBER (serveurs C2 malware, abuse.ch) ───────────────────
      map.addSource('live-cyber', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'live-cyber-dots',
        type: 'circle',
        source: 'live-cyber',
        paint: {
          'circle-radius': 5,
          'circle-color': '#db6f78',
          'circle-opacity': 0.75,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#070a0f',
        },
        layout: { visibility: 'none' },
      });
      map.on('click', 'live-cyber-dots', (e) => {
        const f = e.features?.[0]; if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point' ? (geom.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        const html =
          `<div style="${POPUP_STYLE}">` +
          `<div style="color:#db6f78;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Serveur C2 · menace</div>` +
          `<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:4px;">${escapeHtml(p.ip || '—')}</div>` +
          `<div style="color:#c2cbd8;font-size:12px;line-height:1.6;">Malware : ${escapeHtml(p.malware || '—')}<br>Pays : ${escapeHtml(p.country || '—')}</div>` +
          `<div style="color:#586475;font-size:10px;margin-top:8px;">source abuse.ch (public) · veille défensive</div>` +
          `</div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '340px', offset: 14 })
          .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'live-cyber-dots', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-cyber-dots', () => { map.getCanvas().style.cursor = ''; });
      // ──────────────────────────────────────────────────────────────────

      setMapReady(true);
    });

    // ── Events → callbacks parents ──
    let lastMove = 0;
    map.on('mousemove', e => {
      const now = Date.now();
      if (now - lastMove > 100) {
        lastMove = now;
        onMouseCoords?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      }
    });
    map.on('contextmenu', e => { e.preventDefault(); onRightClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    // Emprise visible → parent (live.setBBox). Clamp aux plages valides : en vue
    // monde/globe, getBounds() peut dépasser ±180/±90 et le serveur rejetterait
    // la bbox (retour silencieux à la France).
    const emitBounds = () => {
      if (!onBoundsChange) return;
      try {
        const b = map.getBounds();
        onBoundsChange([
          Math.max(-180, b.getWest()),
          Math.max(-90, b.getSouth()),
          Math.min(180, b.getEast()),
          Math.min(90, b.getNorth()),
        ]);
      } catch { /* carte pas prête → prochain moveend */ }
    };
    map.on('load', emitBounds); // emprise initiale (sinon 1er fetch = bbox défaut France)
    map.on('moveend', () => {
      const c = map.getCenter();
      onViewStateChange?.({ zoom: map.getZoom(), latitude: c.lat });
      emitBounds();
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── POPUP HELPER (à réutiliser dans les handlers de couche FR) ──
  const pStyle = `background:rgba(13,18,27,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'IBM Plex Mono',monospace;`;
  const showPopup = useCallback((coords: maplibregl.LngLatLike, html: string) => {
    const map = mapRef.current;
    if (!map) return;
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 })
      .setLngLat(coords).setHTML(html).addTo(map);
  }, []);
  // `pStyle`/`showPopup` volontairement exposés : gabarit pour les popups FR.
  void pStyle; void showPopup; void onEntityClick;

  // ── HELPERS DE RENDU ──
  const setGeo = useCallback((source: string, features: any[]) => {
    const src = mapRef.current?.getSource(source) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData({ type: 'FeatureCollection', features });
  }, []);

  const setVis = useCallback((ids: string[], visible: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    ids.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); });
  }, []);
  void setVis;

  // ─── RENDU DES COUCHES DE RÉSULTATS FR (search-first) ────────────────
  // `data[key]` = points plottés (api.buildMapData) : { lat, lng, card }.
  // Chaque couche est alimentée + affichée/masquée selon le toggle sidebar.
  useEffect(() => {
    if (!mapReady) return;
    FR_LAYERS.forEach(({ key, src, layer, label }) => {
      const rows: FrPlotRow[] = Array.isArray(data?.[key]) ? data[key] : [];
      const features = rows
        .filter((r) => typeof r?.lat === 'number' && typeof r?.lng === 'number')
        .map((r) => {
          const card = r.card || {};
          return {
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
            properties: {
              typeLabel: label,
              title: card.title ?? '',
              subtitle: card.subtitle ?? '',
              summary: card.summary ?? '',
              source: card.source_label ?? '',
            },
          };
        });
      setGeo(src, features);
      setVis([layer], !!activeLayers?.[key]);
    });
  }, [mapReady, data, activeLayers, setGeo, setVis]);
  // ─────────────────────────────────────────────────────────────────────

  // ─── RENDU COUCHE TEMPS RÉEL : AVIONS ────────────────────────────────
  // `aircraft` = positions live (adsb.lol via /live-feed/fast, lissées par
  // interpolation). On (re)construit la FeatureCollection à chaque changement
  // et on affiche/masque selon le toggle live_aircraft.
  useEffect(() => {
    if (!mapReady) return;
    const rows = Array.isArray(aircraft) ? aircraft : [];
    const features = rows
      .filter((a) => typeof a?.lat === 'number' && typeof a?.lng === 'number')
      .map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
        properties: {
          id: a.hex ?? a.id ?? '',
          heading: typeof a.heading === 'number' ? a.heading : 0,
          callsign: a.callsign ?? '',
          hex: a.hex ?? a.id ?? '',
          alt: a.alt ?? '',
          speed: a.speed ?? '',
          category: a.category ?? '',
          reg: a.reg ?? '',
          acType: a.acType ?? '',
          // Icône colorée par catégorie ; VIP garde son rendu halo dédié.
          iconId: `plane-${aircraftCatKey(a.category, a.mil)}`,
          vip: !!a.vip,
          vipName: a.vipName ?? '',
          vipCategory: a.vipCategory ?? '',
          vipColor: a.vipColor ?? '',
        },
      }));
    setGeo('live-aircraft', features);
    setVis(['live-aircraft-symbols'], !!activeLayers?.live_aircraft);
    // Traînées : on ENREGISTRE l'historique de tous les avions, mais on ne
    // DESSINE que la route de l'avion SÉLECTIONNÉ (+ les VIP) — comme les apps
    // de référence (FR24…). Tout tracer = des centaines de micro-tirets
    // illisibles (retour Cissou 07/07, « confettis » sur l'Europe).
    // ⚠️ PAS de pruneEntities (07/07) : un tick raté effaçait l'historique.
    // L'élagage par ÂGE de recordPositions/buildTrails (10 min) suffit.
    const now = Date.now();
    const alive = rows.filter((a) => typeof a?.lat === 'number' && typeof a?.lng === 'number');
    recordPositions('aircraft', alive.map((a) => ({ id: String(a.hex ?? a.id ?? ''), lat: a.lat, lng: a.lng })), now);
    const wantedTrails = new Set<string>(
      rows.filter((a) => a?.vip).map((a) => String(a.hex ?? a.id ?? '')),
    );
    if (selectedAircraftHex) wantedTrails.add(String(selectedAircraftHex));
    const trailFeats = buildTrails('aircraft', now).features.filter((f) =>
      wantedTrails.has(String(f.properties?.id ?? '')),
    );
    setGeo('aircraft-trails', trailFeats);
    setVis(['aircraft-trails-line'], !!activeLayers?.live_aircraft);
    // Halo VIP : sous-ensemble taggé vip=true (forme 2), affiché avec les avions.
    const vipFeatures = rows
      .filter((a) => a?.vip && typeof a?.lat === 'number' && typeof a?.lng === 'number')
      .map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
        properties: { vipColor: a.vipColor ?? '#9a8cef', vipName: a.vipName ?? '' },
      }));
    setGeo('live-aircraft-vip', vipFeatures);
    setVis(['live-aircraft-vip-halo'], !!activeLayers?.live_aircraft);
  }, [mapReady, aircraft, activeLayers, selectedAircraftHex, setGeo, setVis]);
  // ─────────────────────────────────────────────────────────────────────

  // ─── RENDU COUCHES GÉOPHYSIQUES (séismes / feux / volcans) ───────────
  // Chaque couche = tableau de points normalisés (route slow) → FeatureCollection,
  // affichée/masquée selon son toggle. Dégradation douce : tableau vide = rien.
  useEffect(() => {
    if (!mapReady) return;
    const quakeFeats = (Array.isArray(earthquakes) ? earthquakes : [])
      .filter((q) => typeof q?.lat === 'number' && typeof q?.lng === 'number')
      .map((q) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [q.lng, q.lat] },
        properties: { mag: typeof q.mag === 'number' ? q.mag : 0, place: q.place ?? '', depth: q.depth ?? '' },
      }));
    setGeo('live-quakes', quakeFeats);
    setVis(['live-quakes-dots'], !!activeLayers?.live_earthquakes);

    const fireFeats = (Array.isArray(wildfires) ? wildfires : [])
      .filter((f) => typeof f?.lat === 'number' && typeof f?.lng === 'number')
      .map((f) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [f.lng, f.lat] },
        properties: { bright: f.bright ?? '' },
      }));
    setGeo('live-fires', fireFeats);
    setVis(['live-fires-dots'], !!activeLayers?.live_wildfires);

    const volcFeats = (Array.isArray(volcanoes) ? volcanoes : [])
      .filter((v) => typeof v?.lat === 'number' && typeof v?.lng === 'number')
      .map((v) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
        properties: { name: v.name ?? '', status: v.status ?? '' },
      }));
    setGeo('live-volcanoes', volcFeats);
    setVis(['live-volcanoes-dots'], !!activeLayers?.live_volcanoes);

    const satFeats = (Array.isArray(satellites) ? satellites : [])
      .filter((s) => typeof s?.lat === 'number' && typeof s?.lng === 'number')
      .map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: { id: s.id ?? '', name: s.name ?? '', alt: s.alt != null ? Math.round(s.alt) : '' },
      }));
    setGeo('live-satellites', satFeats);
    setVis(['live-satellites-dots'], !!activeLayers?.live_satellites);

    const gdeltFeats = (Array.isArray(gdelt) ? gdelt : [])
      .filter((g) => typeof g?.lat === 'number' && typeof g?.lng === 'number')
      .map((g) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [g.lng, g.lat] },
        properties: { title: g.title ?? '', name: g.name ?? '', tone: g.tone ?? '', url: g.url ?? '' },
      }));
    setGeo('live-gdelt', gdeltFeats);
    setVis(['live-gdelt-dots'], !!activeLayers?.live_gdelt);

    const cyberFeats = (Array.isArray(cyber) ? cyber : [])
      .filter((c) => typeof c?.lat === 'number' && typeof c?.lng === 'number')
      .map((c) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
        properties: { ip: c.ip ?? '', malware: c.malware ?? '', country: c.country ?? '' },
      }));
    setGeo('live-cyber', cyberFeats);
    setVis(['live-cyber-dots'], !!activeLayers?.live_cyber);
  }, [mapReady, earthquakes, wildfires, volcanoes, satellites, gdelt, cyber, activeLayers, setGeo, setVis]);
  // ─────────────────────────────────────────────────────────────────────

  // ─── RENDU NAVIRES (AIS) + traînées ──────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const rows = (Array.isArray(ships) ? ships : []).filter((s) => typeof s?.lat === 'number' && typeof s?.lng === 'number');
    setGeo('live-ships', rows.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      properties: { name: s.name ?? '', mmsi: s.mmsi ?? '', type: s.type ?? '', speed: s.speed ?? '' },
    })));
    setVis(['live-ships-dots'], !!activeLayers?.live_ships);
    const now = Date.now();
    recordPositions('ships', rows.map((s) => ({ id: String(s.id ?? s.mmsi ?? ''), lat: s.lat, lng: s.lng })), now);
    // Pas de pruneEntities (07/07) : même raison que les avions — un tick raté
    // effaçait l'historique. L'élagage par âge (10 min) suffit.
    setGeo('ships-trails', buildTrails('ships', now).features);
    setVis(['ships-trails-line'], !!activeLayers?.live_ships);
  }, [mapReady, ships, activeLayers, setGeo, setVis]);

  // ─── RENDU COUCHES SENSIBLES (forme 2) ───────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    SENSITIVE_MAP_LAYERS.forEach(({ toggle, dataKey }) => {
      const rows = (Array.isArray(sensitive?.[dataKey]) ? sensitive[dataKey]! : [])
        .filter((p) => typeof p?.lat === 'number' && typeof p?.lng === 'number');
      setGeo(`sens-${dataKey}`, rows.map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: { id: p.id ?? '', label: p.label ?? '', name: p.name ?? '', streamUrl: p.streamUrl ?? '', type: p.type ?? '' },
      })));
      setVis([`sens-${dataKey}-dots`], !!activeLayers?.[toggle]);
    });
  }, [mapReady, sensitive, activeLayers, setGeo, setVis]);
  // ─────────────────────────────────────────────────────────────────────

  // ── Couche jour/nuit (affichage, conservée du châssis d'origine) ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const update = () => {
      const src = map.getSource('day-night') as maplibregl.GeoJSONSource | undefined;
      if (!src) return;
      if (!activeLayers.day_night) { src.setData(EMPTY_FC); return; }
      src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [computeSolarTerminator()] }, properties: {} }] });
    };
    update();
    if (map.getLayer('day-night-fill')) map.setLayoutProperty('day-night-fill', 'visibility', activeLayers.day_night ? 'visible' : 'none');
    const iv = setInterval(update, 300000); // 5 min
    return () => clearInterval(iv);
  }, [mapReady, activeLayers.day_night]);

  // ── Fly-to ──
  useEffect(() => {
    if (!mapReady || !mapRef.current || !flyToLocation) return;
    mapRef.current.flyTo({ center: [flyToLocation.lng, flyToLocation.lat], zoom: 8, duration: 2000 });
  }, [mapReady, flyToLocation]);

  // ── Bascule projection globe / mercator (+ sky sur globe) ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    try {
      (map as any).setProjection({ type: projection });
      if (projection === 'globe') {
        map.easeTo({ pitch: 20, duration: 1200 });
        try {
          (map as any).setSky({
            'sky-color': '#070a0f',
            'sky-horizon-blend': 0.5,
            'horizon-color': '#0a0a1a',
            'horizon-fog-blend': 0.3,
            'fog-color': '#070a0f',
            'fog-ground-blend': 0.9,
          });
        } catch { /* sky non supporté */ }
      } else {
        map.easeTo({ pitch: 0, duration: 800 });
      }
    } catch (e) {
      console.warn('[OSIRIS] Projection switch failed:', e);
    }
  }, [mapReady, projection]);

  // ── Fonds raster modernes (satellite ArcGIS + Plan IGN + SCAN25 + Ortho IGN) ──
  // Config déplacée en module scope (RASTER_BASES). Chaque fond = un calque raster
  // sous l'historique/les points ; un seul visible selon `mapStyle` ('dark' = aucun).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (mapStyle === prevStyleRef.current) return;
    prevStyleRef.current = mapStyle;
    const map = mapRef.current;
    try {
      const anchor = map.getLayer('day-night-fill') ? 'day-night-fill' : undefined;
      for (const [key, cfg] of Object.entries(RASTER_BASES)) {
        const layerId = `base-${key}`;
        const active = mapStyle === key;
        if (active && !map.getSource(`src-${key}`)) {
          map.addSource(`src-${key}`, { type: 'raster', tiles: [cfg.tiles], tileSize: cfg.tileSize, minzoom: cfg.minzoom, maxzoom: cfg.maxzoom });
          map.addLayer({ id: layerId, type: 'raster', source: `src-${key}`, paint: { 'raster-opacity': cfg.opacity } }, anchor);
        } else if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', active ? 'visible' : 'none');
        }
      }
      restackRasters(map); // fond < temps < surcouches < points
    } catch (e) {
      console.warn('[OSIRIS] Style switch failed:', e);
    }
  }, [mapReady, mapStyle]);

  // ── Couche « REMONTER LE TEMPS » — au-dessus du fond, sous les surcouches ──
  // Un seul calque à la fois. L'ortho annuelle a un identifiant DYNAMIQUE
  // (ORTHOIMAGERY.ORTHOPHOTOS<ANNEE>) : on reconstruit source+layer à chaque
  // changement de `timeLayer` OU d'`orthoYear` (swap propre = remove puis add).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    try {
      const anchor = map.getLayer('day-night-fill') ? 'day-night-fill' : undefined;
      // Purge systématique du calque temps précédent (identifiant peut avoir changé).
      if (map.getLayer(ID_TIME_LAYER)) map.removeLayer(ID_TIME_LAYER);
      if (map.getSource('time-src')) map.removeSource('time-src');

      let cfg: { tiles: string; minzoom: number; maxzoom: number } | null = null;
      if (timeLayer === 'ortho-year') {
        // Identifiant construit depuis l'année du curseur (série uniforme jpeg 0-18).
        cfg = { tiles: wmts(`ORTHOIMAGERY.ORTHOPHOTOS${orthoYear}`, 'image/jpeg'), minzoom: 0, maxzoom: 18 };
      } else if (timeLayer !== 'none' && TIME_LAYERS[timeLayer]) {
        cfg = TIME_LAYERS[timeLayer];
      }

      if (cfg) {
        map.addSource('time-src', { type: 'raster', tiles: [cfg.tiles], tileSize: 256, minzoom: cfg.minzoom, maxzoom: cfg.maxzoom });
        map.addLayer({ id: ID_TIME_LAYER, type: 'raster', source: 'time-src', paint: { 'raster-opacity': 1 } }, anchor);
      }
      restackRasters(map); // fond < temps < surcouches < points
    } catch (e) {
      console.warn('[OSIRIS] Time layer toggle failed:', e);
    }
  }, [mapReady, timeLayer, orthoYear]);

  // ── SURCOUCHES thématiques IGN (plusieurs simultanées) — au-dessus du temps ──
  // Lazy-add au 1ᵉ affichage puis simple bascule de visibilité. L'ordre stable
  // est garanti par restackRasters (OVERLAY_ORDER).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    try {
      const anchor = map.getLayer('day-night-fill') ? 'day-night-fill' : undefined;
      for (const key of OVERLAY_ORDER) {
        const cfg = OVERLAYS[key];
        const layerId = `ov-${key}`;
        const active = !!overlays[key];
        if (active && !map.getSource(`ovsrc-${key}`)) {
          map.addSource(`ovsrc-${key}`, { type: 'raster', tiles: [cfg.tiles], tileSize: 256, minzoom: cfg.minzoom, maxzoom: cfg.maxzoom });
          map.addLayer({ id: layerId, type: 'raster', source: `ovsrc-${key}`, paint: { 'raster-opacity': cfg.opacity } }, anchor);
        } else if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', active ? 'visible' : 'none');
        }
      }
      restackRasters(map); // fond < temps < surcouches < points
    } catch (e) {
      console.warn('[OSIRIS] Overlays toggle failed:', e);
    }
  }, [mapReady, overlays]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}

export default memo(OsirisMap);
