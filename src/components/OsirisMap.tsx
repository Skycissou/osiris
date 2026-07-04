'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ─────────────────────────────────────────────────────────────────────────
//  OsirisMap — CHÂSSIS carto MapLibre (OSIRIS V4 LEAN)
//  Fournit uniquement la base cartographique + les helpers de rendu.
//  Les couches de données FR (Entreprises, BODACC, DVF, BAN, RNA…) seront
//  câblées ici quand le backend FastAPI sera dispo — voir le gabarit commenté
//  plus bas (`useEffect(setGeo(...))`).
// ─────────────────────────────────────────────────────────────────────────

interface OsirisMapProps {
  /** Données brutes issues du backend FR (clés à définir couche par couche). */
  data?: Record<string, any>;
  /** Etat des couches actives (clés FR stub — cf. LayerPanel). */
  activeLayers: Record<string, boolean>;
  onEntityClick?: (entity: any) => void;
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  onViewStateChange?: (vs: { zoom: number; latitude: number }) => void;
  flyToLocation?: { lat: number; lng: number; ts: number } | null;
  projection?: 'mercator' | 'globe';
  /** 'dark' = basemap CARTO dark · autre = calque raster satellite. */
  mapStyle?: string;
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

// Centre par défaut : France métropolitaine.
const DEFAULT_CENTER: [number, number] = [2.35, 46.6];
const DEFAULT_ZOOM = 5.2;

function OsirisMap({
  data = {},
  activeLayers,
  onEntityClick,
  onMouseCoords,
  onRightClick,
  onViewStateChange,
  flyToLocation,
  projection = 'mercator',
  mapStyle = 'dark',
}: OsirisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const prevStyleRef = useRef(mapStyle);

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
        // Toutes les requêtes CARTO CDN passent par le proxy interne Next.js.
        if (url.includes('cartocdn.com')) {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
          return { url: `${baseUrl}/api/proxy-tiles?url=${encodeURIComponent(url)}` };
        }
        return { url };
      },
    });

    map.on('load', () => {
      mapRef.current = map;

      // Icônes/pastilles de base réutilisables par les futures couches FR.
      createIcon(map, 'plane', '#00E5FF', 24);
      createDot(map, 'dot-gold', '#D4AF37', 8);

      // Source jour/nuit (couche d'affichage optionnelle conservée).
      map.addSource('day-night', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({ id: 'day-night-fill', type: 'fill', source: 'day-night', paint: { 'fill-color': '#000022', 'fill-opacity': 0.35 } });

      // ─── GABARIT VIDE — À DÉCOMMENTER PAR COUCHE FR ───────────────────
      // Chaque couche FR suit ce patron : 1 source geojson + 1..n addLayer.
      // Ex. couche "Entreprises" (points) :
      //
      // map.addSource('fr-entreprises', { type: 'geojson', data: EMPTY_FC });
      // map.addLayer({ id: 'fr-entreprises-dots', type: 'circle', source: 'fr-entreprises', paint: {
      //   'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 8],
      //   'circle-color': '#D4AF37', 'circle-opacity': 0.85,
      //   'circle-stroke-width': 1, 'circle-stroke-color': '#000',
      // }});
      // → alimentée plus bas par un useEffect(setGeo('fr-entreprises', ...)).
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
  const pStyle = `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;`;
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

  // ─── GABARIT VIDE — RENDU D'UNE COUCHE FR ────────────────────────────
  // Reproduire ce bloc par couche quand le backend FastAPI expose la donnée :
  //
  // useEffect(() => {
  //   if (!mapReady) return;
  //   const rows = activeLayers.fr_entreprises && data.fr_entreprises ? data.fr_entreprises : [];
  //   setGeo('fr-entreprises', rows.map((r: any) => ({
  //     type: 'Feature',
  //     geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
  //     properties: { siren: r.siren, nom: r.nom },
  //   })));
  //   setVis(['fr-entreprises-dots'], !!activeLayers.fr_entreprises);
  // }, [mapReady, data.fr_entreprises, activeLayers.fr_entreprises, setGeo, setVis]);
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
            'sky-color': '#04040A',
            'sky-horizon-blend': 0.5,
            'horizon-color': '#0a0a1a',
            'horizon-fog-blend': 0.3,
            'fog-color': '#04040A',
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

  // ── Bascule style dark / satellite (calque raster ArcGIS) ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (mapStyle === prevStyleRef.current) return;
    prevStyleRef.current = mapStyle;
    const map = mapRef.current;
    try {
      if (mapStyle !== 'dark') {
        if (!map.getSource('satellite-tiles')) {
          map.addSource('satellite-tiles', {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 18,
          });
          const firstLayer = map.getLayer('day-night-fill') ? 'day-night-fill' : undefined;
          map.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 0.85 } }, firstLayer);
        } else {
          map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
        }
      } else if (map.getLayer('satellite-layer')) {
        map.setLayoutProperty('satellite-layer', 'visibility', 'none');
      }
    } catch (e) {
      console.warn('[OSIRIS] Style switch failed:', e);
    }
  }, [mapReady, mapStyle]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
}

export default memo(OsirisMap);
