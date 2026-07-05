'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BASE_PATH } from '@/lib/api';

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
}

interface OsirisMapProps {
  /** Données brutes issues du backend FR (clés à définir couche par couche). */
  data?: Record<string, any>;
  /** Etat des couches actives (clés FR stub — cf. LayerPanel). */
  activeLayers: Record<string, boolean>;
  /** Avions temps réel (adsb.lol) — rendus si activeLayers.live_aircraft. */
  aircraft?: AircraftPoint[];
  onEntityClick?: (entity: any) => void;
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  onViewStateChange?: (vs: { zoom: number; latitude: number }) => void;
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
  onEntityClick,
  onMouseCoords,
  onRightClick,
  onViewStateChange,
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

  // ── Générateur d'icône "avion" sur canvas (gabarit symbole WebGL) ──
  const createIcon = useCallback((map: maplibregl.Map, id: string, color: string, size: number) => {
    if (map.hasImage(id)) return;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2, cy = size / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.4);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.1);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.2);
    ctx.lineTo(cx - size * 0.4, cy + size * 0.3);
    ctx.lineTo(cx - size * 0.12, cy + size * 0.15);
    ctx.lineTo(cx, cy + size * 0.35);
    ctx.lineTo(cx + size * 0.12, cy + size * 0.15);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.3);
    ctx.lineTo(cx + size * 0.4, cy + size * 0.2);
    ctx.lineTo(cx + size * 0.12, cy + size * 0.1);
    ctx.closePath();
    ctx.fill();
    map.addImage(id, { width: size, height: size, data: new Uint8Array(ctx.getImageData(0, 0, size, size).data) });
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

      // Icônes/pastilles de base réutilisables par les futures couches FR.
      createIcon(map, 'plane', '#9bdcf0', 24);
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
          'icon-image': 'plane',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.1],
          'icon-rotate': ['coalesce', ['get', 'heading'], 0],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          visibility: 'none',
        },
      });
      map.on('click', 'live-aircraft-symbols', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties || {};
        const geom = f.geometry;
        const coords = geom && geom.type === 'Point'
          ? (geom.coordinates as [number, number])
          : [e.lngLat.lng, e.lngLat.lat];
        const alt = p.alt != null && p.alt !== '' ? `${escapeHtml(p.alt)} ft` : '—';
        const spd = p.speed != null && p.speed !== '' ? `${escapeHtml(p.speed)} nds` : '—';
        const hdg = p.heading != null && p.heading !== '' ? `${escapeHtml(p.heading)}°` : '—';
        const html =
          `<div style="${POPUP_STYLE}">` +
          `<div style="color:#9bdcf0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Aéronef · temps réel</div>` +
          `<div style="color:#fff;font-size:14px;font-weight:600;margin-bottom:6px;">${escapeHtml(p.callsign || p.hex || 'Inconnu')}</div>` +
          `<div style="color:#c2cbd8;font-size:12px;line-height:1.6;">` +
          `Altitude : ${alt}<br>Vitesse sol : ${spd}<br>Cap : ${hdg}</div>` +
          `<div style="color:#586475;font-size:10px;margin-top:8px;">hex ${escapeHtml(p.hex || '—')} · source adsb.lol (public)</div>` +
          `</div>`;
        popupRef.current?.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '360px', offset: 14 })
          .setLngLat(coords as maplibregl.LngLatLike).setHTML(html).addTo(map);
      });
      map.on('mouseenter', 'live-aircraft-symbols', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'live-aircraft-symbols', () => { map.getCanvas().style.cursor = ''; });
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
    map.on('moveend', () => { const c = map.getCenter(); onViewStateChange?.({ zoom: map.getZoom(), latitude: c.lat }); });

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
  // `aircraft` = positions live (adsb.lol via /api/live-data/fast, lissées par
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
          heading: typeof a.heading === 'number' ? a.heading : 0,
          callsign: a.callsign ?? '',
          hex: a.hex ?? a.id ?? '',
          alt: a.alt ?? '',
          speed: a.speed ?? '',
        },
      }));
    setGeo('live-aircraft', features);
    setVis(['live-aircraft-symbols'], !!activeLayers?.live_aircraft);
  }, [mapReady, aircraft, activeLayers, setGeo, setVis]);
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
