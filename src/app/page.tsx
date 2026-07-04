'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Globe, MapPinned } from 'lucide-react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { search, buildMapData, type SearchResponse, type PlotPoint } from '@/lib/api';

const OsirisMap = dynamic(() => import('@/components/OsirisMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));
const SearchBar = dynamic(() => import('@/components/SearchBar'), { ssr: false });
const ResultsPanel = dynamic(() => import('@/components/ResultsPanel'), { ssr: false });
const LoginGate = dynamic(() => import('@/components/LoginGate'), { ssr: false });

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
  // Auth : null = en cours de check, false = login requis, true = cockpit.
  // Le cookie de session est httponly (illisible en JS) → on garde un flag
  // souple en localStorage ; un 401 sur /search y ramène (session expirée).
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    setAuthed(typeof window !== 'undefined' && localStorage.getItem('osiris_authed') === '1');
  }, []);
  const handleAuthed = useCallback(() => {
    if (typeof window !== 'undefined') localStorage.setItem('osiris_authed', '1');
    setAuthed(true);
  }, []);

  // Points plottés par couche fr_* (issus de la recherche backend → api.buildMapData).
  const [data, setData] = useState<Record<string, PlotPoint[]>>({});
  // Réponse brute de la dernière recherche (alimente le panneau résultats).
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [plottedCount, setPlottedCount] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);

  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [mapProjection, setMapProjection] = useState<'globe' | 'mercator'>('mercator');
  // Fonds : Sombre (CARTO) → Plan IGN → SCAN25 → Ortho IGN → Satellite (cycle).
  const BASEMAPS = ['dark', 'ign', 'scan25', 'ortho', 'satellite'] as const;
  const BASEMAP_LABEL: Record<string, string> = { dark: 'SOMBRE', ign: 'PLAN IGN', scan25: 'SCAN25', ortho: 'ORTHO', satellite: 'SAT' };
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'ign' | 'scan25' | 'ortho'>('dark');
  // Couche historique (remonter le temps) : ACTUEL → 1950 photo → CARTE 1950 → État-major → Cassini.
  const HISTMAPS = ['none', 'ortho1950', 'scan50', 'etatmajor', 'cassini'] as const;
  const HISTMAP_LABEL: Record<string, string> = { none: 'ACTUEL', ortho1950: '1950 (photo)', scan50: 'CARTE 1950', etatmajor: 'ÉTAT-MAJOR', cassini: 'CASSINI' };
  const [histLayer, setHistLayer] = useState<'none' | 'ortho1950' | 'scan50' | 'etatmajor' | 'cassini'>('none');
  const [cadastre, setCadastre] = useState(false);
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>(DEFAULT_LAYERS);

  // ── Recherche cible (search-first) : appelle le backend puis plotte ──
  const runSearch = useCallback(async (q: string) => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const resp = await search(q);
      setResponse(resp);
      const md = buildMapData(resp);
      setData(md);
      const count = Object.values(md).reduce((n, arr) => n + arr.length, 0);
      setPlottedCount(count);
      setShowResults(true);
      // Auto-active les couches qui ont des points, laisse les autres telles quelles.
      setActiveLayers((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(md)) if (md[k].length) next[k] = true;
        return next;
      });
      // Recentre sur le premier point géolocalisé s'il y en a un.
      const firstKey = Object.keys(md).find((k) => md[k].length > 0);
      if (firstKey) {
        const p = md[firstKey][0];
        setFlyToLocation({ lat: p.lat, lng: p.lng, ts: Date.now() });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur inconnue';
      // Session expirée / non authentifié → retour à l'écran de login.
      if (msg.includes('401')) {
        if (typeof window !== 'undefined') localStorage.removeItem('osiris_authed');
        setAuthed(false);
        return;
      }
      setSearchError(msg);
      setResponse(null);
      setPlottedCount(null);
    } finally {
      setSearchLoading(false);
    }
  }, []);

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

  // Écran d'accès tant que non authentifié (null = check en cours → rien).
  if (authed === null) return <main className="fixed inset-0 bg-[var(--bg-void)]" />;
  if (!authed) return <LoginGate onAuthed={handleAuthed} />;

  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg-void)] overflow-hidden">
      {/* ── CARTE ── */}
      <ErrorBoundary name="Carte">
        <OsirisMap
          data={data}
          activeLayers={activeLayers}
          projection={mapProjection}
          mapStyle={mapStyle}
          histLayer={histLayer}
          cadastre={cadastre}
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

      {/* ── BARRE DE RECHERCHE (search-first) ── */}
      <ErrorBoundary name="Recherche">
        <SearchBar
          onSubmit={runSearch}
          loading={searchLoading}
          error={searchError}
          resultCount={plottedCount}
          isMobile={isMobile}
        />
      </ErrorBoundary>

      {/* ── PANNEAU RÉSULTATS ── */}
      {showResults && response && (
        <ErrorBoundary name="Résultats">
          <ResultsPanel
            response={response}
            onClose={() => setShowResults(false)}
            onFlyTo={({ lat, lng, label }) => {
              setFlyToLocation({ lat, lng, ts: Date.now() });
              setLocationLabel(label);
            }}
            isMobile={isMobile}
          />
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
          onClick={() => setMapStyle((s) => BASEMAPS[(BASEMAPS.indexOf(s) + 1) % BASEMAPS.length])}
          className="glass-panel px-3 py-2 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors text-[9px] font-mono tracking-widest text-[var(--cyan-primary)] min-w-[72px]"
          title="Changer de fond de carte (Sombre / Plan IGN / Ortho / Satellite)"
        >
          {BASEMAP_LABEL[mapStyle]}
        </button>
        <button
          onClick={() => setHistLayer((h) => HISTMAPS[(HISTMAPS.indexOf(h) + 1) % HISTMAPS.length])}
          className={`glass-panel px-3 py-2 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors text-[9px] font-mono tracking-widest min-w-[72px] ${histLayer !== 'none' ? 'text-[var(--gold-primary)] border-[var(--gold-primary)]/50' : 'text-[var(--text-muted)]'}`}
          title="Remonter le temps (Actuel / 1950 photo / Carte 1950 / État-major / Cassini)"
        >
          {HISTMAP_LABEL[histLayer]}
        </button>
        <button
          onClick={() => setCadastre((c) => !c)}
          className={`glass-panel px-3 py-2 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors text-[9px] font-mono tracking-widest ${cadastre ? 'text-[var(--gold-primary)] border-[var(--gold-primary)]/50' : 'text-[var(--text-muted)]'}`}
          title="Surcouche cadastre IGN (parcelles)"
        >
          CAD
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
