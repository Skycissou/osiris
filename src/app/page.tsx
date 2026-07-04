'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Globe, MapPinned, Satellite, Moon } from 'lucide-react';
import ErrorBoundary from '@/components/ErrorBoundary';

const OsirisMap = dynamic(() => import('@/components/OsirisMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));

// Couches FR (stub) — clés canoniques partagées avec LayerPanel + OsirisMap.
const DEFAULT_LAYERS: Record<string, boolean> = {
  fr_entreprises: false,
  fr_bodacc: false,
  fr_dvf: false,
  fr_ban: false,
  fr_rna: false,
  day_night: false,
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setIsMobile(w < 768 || (h < 500 && w < 1024));
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  return isMobile;
}

export default function Dashboard() {
  // Données brutes du backend FR (à alimenter via src/lib/api.ts, couche par couche).
  const [data] = useState<Record<string, any>>({});

  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [mapProjection, setMapProjection] = useState<'globe' | 'mercator'>('mercator');
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite'>('dark');
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>(DEFAULT_LAYERS);

  const isMobile = useIsMobile();
  const coordsDisplayRef = useRef<HTMLDivElement>(null);
  const geocodeCache = useRef<Map<string, string>>(new Map());
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedPos = useRef<{ lat: number; lng: number } | null>(null);

  // ── Restauration des couches actives depuis l'URL (bijou conservé) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const layers = p.get('layers');
    if (layers) {
      const active = layers.split(',');
      setActiveLayers((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => { next[k] = active.includes(k); });
        return next;
      });
    }
  }, []);

  // ── Persistance des couches actives dans l'URL (debounce) ──
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const active = Object.entries(activeLayers).filter(([, v]) => v).map(([k]) => k).join(',');
      window.history.replaceState(null, '', `${window.location.pathname}?layers=${active}`);
    }, 1500);
  }, [activeLayers]);

  // ── Coordonnées souris + reverse-geocode (Nominatim public, hors backend FR) ──
  const handleMouseCoords = useCallback((coords: { lat: number; lng: number }) => {
    if (coordsDisplayRef.current) {
      coordsDisplayRef.current.innerText = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      if (lastGeocodedPos.current) {
        const d = Math.abs(coords.lat - lastGeocodedPos.current.lat) + Math.abs(coords.lng - lastGeocodedPos.current.lng);
        if (d < 0.5) return;
      }
      const gk = `${coords.lat.toFixed(1)},${coords.lng.toFixed(1)}`;
      if (geocodeCache.current.has(gk)) { setLocationLabel(geocodeCache.current.get(gk)!); lastGeocodedPos.current = coords; return; }
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=10&addressdetails=1`,
          { headers: { 'Accept-Language': 'fr' } }
        );
        if (res.ok) {
          const d = await res.json();
          const a = d.address || {};
          const label = [a.city || a.town || a.village || a.county, a.state || a.region, a.country].filter(Boolean).join(', ') || 'Inconnu';
          if (geocodeCache.current.size > 500) {
            const it = geocodeCache.current.keys();
            for (let i = 0; i < 100; i++) { const k = it.next().value; if (k) geocodeCache.current.delete(k); }
          }
          geocodeCache.current.set(gk, label);
          setLocationLabel(label);
          lastGeocodedPos.current = coords;
        }
      } catch (e) { console.warn('[OSIRIS] geocode:', e instanceof Error ? e.message : e); }
    }, 3000);
  }, []);

  // Clic droit sur la carte → réservé aux futurs dossiers de zone FR.
  const handleRightClick = useCallback((_coords: { lat: number; lng: number }) => {
    // TODO: appeler le backend FR (dossier de zone) via src/lib/api.ts.
  }, []);

  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg-void)] overflow-hidden">
      {/* ── CARTE ── */}
      <ErrorBoundary name="Carte">
        <OsirisMap
          data={data}
          activeLayers={activeLayers}
          projection={mapProjection}
          mapStyle={mapStyle}
          onMouseCoords={handleMouseCoords}
          onRightClick={handleRightClick}
          flyToLocation={flyToLocation}
        />
      </ErrorBoundary>

      {/* ── PANNEAU COUCHES (desktop) ── */}
      {!isMobile && (
        <ErrorBoundary name="Couches">
          <LayerPanel data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} />
        </ErrorBoundary>
      )}

      {/* ── EN-TÊTE ── */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="absolute top-4 z-[200] pointer-events-none flex flex-col"
        style={{ left: isMobile ? '16px' : '100px', right: '16px' }}
      >
        <div className="flex items-center gap-3 w-fit">
          <h1 className="text-lg md:text-xl font-bold tracking-[0.4em] text-[var(--gold-primary)] font-mono">OSIRIS</h1>
          <span className="text-[8px] md:text-[9px] font-mono tracking-[0.2em] opacity-70 uppercase text-[var(--gold-primary)]">
            COCKPIT OSINT · V4
          </span>
        </div>
      </motion.div>

      {/* ── CONTRÔLES CARTE (globe/2D + satellite/nuit + recentrage FR) ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="absolute bottom-[75px] md:bottom-[100px] z-[200] flex items-center gap-2 pointer-events-none"
        style={{ left: isMobile ? '12px' : '120px' }}
      >
        <button
          onClick={() => setMapProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          className="glass-panel p-3.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group"
          title={mapProjection === 'globe' ? 'Vue 2D' : 'Vue Globe 3D'}
        >
          {mapProjection === 'globe'
            ? <MapPinned className="w-5 h-5 text-[var(--gold-primary)] group-hover:scale-110 transition-transform" />
            : <Globe className="w-5 h-5 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />}
        </button>
        <button
          onClick={() => setMapStyle((s) => (s === 'dark' ? 'satellite' : 'dark'))}
          className="glass-panel p-3.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group"
          title={mapStyle === 'dark' ? 'Vue satellite' : 'Vue nuit'}
        >
          {mapStyle === 'dark'
            ? <Satellite className="w-5 h-5 text-[var(--alert-green)] group-hover:scale-110 transition-transform" />
            : <Moon className="w-5 h-5 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />}
        </button>
        <button
          onClick={() => setFlyToLocation({ lat: 46.6, lng: 2.35, ts: Date.now() })}
          className="glass-panel px-3 py-2 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors text-[9px] font-mono tracking-widest text-[var(--gold-primary)]"
          title="Recentrer sur la France"
        >
          FR
        </button>
      </motion.div>

      {/* ── BARRE COORDONNÉES (bas) ── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-none flex items-center gap-3 text-[9px] font-mono tracking-widest text-[var(--text-muted)] glass-panel px-3 py-1.5">
        <div ref={coordsDisplayRef} className="text-[var(--cyan-primary)] tabular-nums">--.----, --.----</div>
        {locationLabel && <span className="text-[var(--text-secondary)] truncate max-w-[40vw]">{locationLabel}</span>}
      </div>
    </main>
  );
}
