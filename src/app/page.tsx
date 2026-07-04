'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Globe, MapPinned, Layers, X } from 'lucide-react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { search, buildMapData, BASE_PATH, type SearchResponse, type PlotPoint } from '@/lib/api';

// Cockpit servi sous basePath (/cockpit) → l'utilisateur arrive DÉJÀ loggué via la
// V3 (cookie httponly même-domaine couvre /search). Dans ce mode on court-circuite
// le LoginGate V4 et, sur 401, on renvoie vers le login V3 à la racine (`/login`).
const COCKPIT_MODE = BASE_PATH !== '';

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

// ── Options du menu de couches (labels lisibles, ordre d'affichage) ──
const BASEMAP_OPTS: { key: 'dark' | 'ign' | 'scan25' | 'ortho' | 'satellite'; label: string }[] = [
  { key: 'dark', label: 'Sombre (défaut)' },
  { key: 'ign', label: 'Plan IGN' },
  { key: 'scan25', label: 'SCAN25 topo' },
  { key: 'ortho', label: 'Ortho (actuelle)' },
  { key: 'satellite', label: 'Satellite' },
];
// « Remonter le temps » : radio unique. 'ortho-year' déclenche le curseur d'année.
const TIME_OPTS: { key: string; label: string }[] = [
  { key: 'none', label: 'Actuel (aucune)' },
  { key: 'ortho-year', label: 'Ortho par année' },
  { key: 'ortho1950', label: 'Photo 1950-1965 (N&B)' },
  { key: 'ortho1965', label: 'Photo 1965-1980 (N&B)' },
  { key: 'ortho1980', label: 'Photo 1980-1995 (N&B)' },
  { key: 'scan50', label: 'Carte 1950' },
  { key: 'etatmajor', label: 'État-Major 1820-1866' },
];
const ORTHO_YEAR_MIN = 2000;
const ORTHO_YEAR_MAX = 2024;
// Surcouches thématiques : checkboxes cumulables.
const OVERLAY_OPTS: { key: string; label: string }[] = [
  { key: 'cadastre', label: 'Cadastre' },
  { key: 'rpg', label: 'Parcelles agricoles' },
  { key: 'forets', label: 'Forêts publiques' },
  { key: 'hydro', label: 'Hydrographie' },
  { key: 'routes', label: 'Routes' },
  { key: 'rail', label: 'Voies ferrées' },
  { key: 'admin', label: 'Limites admin' },
  { key: 'noms', label: 'Toponymes' },
  { key: 'pentes', label: 'Pentes' },
  { key: 'irc', label: 'Infrarouge' },
  { key: 'protected', label: 'Zones protégées' },
];

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
    // Sous /cockpit : on considère l'utilisateur authentifié d'emblée (cookie V3).
    // Un 401 sur une requête le renverra vers /login (V3) — cf. runSearch.
    if (COCKPIT_MODE) { setAuthed(true); return; }
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
  // ── Menu de couches (panneau dépliable) ──
  const [layersOpen, setLayersOpen] = useState(false);
  // Fond moderne actif (radio, un seul).
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'ign' | 'scan25' | 'ortho'>('dark');
  // « Remonter le temps » (radio, un seul) : 'none' | 'ortho-year' | clés décennies/cartes.
  const [timeLayer, setTimeLayer] = useState<string>('none');
  // Année choisie pour l'ortho annuelle (curseur 2000→2024).
  const [orthoYear, setOrthoYear] = useState<number>(2021);
  // Surcouches thématiques (checkboxes, plusieurs simultanées).
  const [overlays, setOverlays] = useState<Record<string, boolean>>({});
  const toggleOverlay = useCallback((k: string) => setOverlays((prev) => ({ ...prev, [k]: !prev[k] })), []);
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
      // Session expirée / non authentifié.
      if (msg.includes('401')) {
        // Mode cockpit : le login vit dans la V3 → redirection racine, pas de gate V4.
        if (COCKPIT_MODE) {
          if (typeof window !== 'undefined') window.location.href = '/login';
          return;
        }
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
          timeLayer={timeLayer}
          orthoYear={orthoYear}
          overlays={overlays}
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
          {/* Lien retour vers la V3 (racine du domaine) — visible seulement sous /cockpit.
              Anchor natif (pas next/link) → href '/' non préfixé par basePath = racine V3. */}
          {COCKPIT_MODE && (
            <a
              href="/"
              className="glass-panel pointer-events-auto px-2.5 py-1 text-[10px] font-mono tracking-widest text-[var(--cyan-primary)] hover:text-[var(--gold-primary)] hover:border-[var(--gold-primary)]/40 transition-colors"
              title="Retour à OSIRIS (V3)"
            >
              ← OSIRIS
            </a>
          )}
          <h1 className="text-lg md:text-xl font-bold tracking-[0.4em] text-[var(--gold-primary)] font-mono">OSIRIS</h1>
          <span className="text-[8px] md:text-[9px] font-mono tracking-[0.2em] opacity-70 uppercase text-[var(--gold-primary)]">
            COCKPIT OSINT · V4
          </span>
        </div>
      </motion.div>

      {/* ── PANNEAU MENU DE COUCHES (dépliable, au-dessus du bouton COUCHES) ── */}
      {layersOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-panel absolute z-[210] pointer-events-auto p-4 w-[248px] overflow-y-auto"
          style={{
            left: isMobile ? '12px' : '120px',
            bottom: isMobile ? '128px' : '153px',
            maxHeight: 'min(62vh, 520px)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-mono font-bold tracking-widest text-[var(--gold-primary)]">COUCHES</span>
            <button
              onClick={() => setLayersOpen(false)}
              className="text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition-colors"
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* FONDS (radio) */}
          <div className="mb-4">
            <div className="text-[9px] font-mono tracking-widest text-[var(--cyan-primary)] uppercase mb-2 pb-1 border-b border-white/10">Fond de carte</div>
            <div className="flex flex-col gap-1">
              {BASEMAP_OPTS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setMapStyle(o.key)}
                  className="flex items-center gap-2.5 px-1.5 py-1 rounded hover:bg-white/5 transition-colors text-left"
                >
                  <span
                    className={`w-3 h-3 rounded-full flex-shrink-0 border ${mapStyle === o.key ? 'bg-[var(--gold-primary)] border-[var(--gold-primary)]' : 'border-white/30'}`}
                  />
                  <span className={`text-[11px] font-mono ${mapStyle === o.key ? 'text-white' : 'text-white/60'}`}>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* REMONTER LE TEMPS (radio + curseur d'année) */}
          <div className="mb-4">
            <div className="text-[9px] font-mono tracking-widest text-[var(--cyan-primary)] uppercase mb-2 pb-1 border-b border-white/10">Remonter le temps</div>
            <div className="flex flex-col gap-1">
              {TIME_OPTS.map((o) => (
                <div key={o.key}>
                  <button
                    onClick={() => setTimeLayer(o.key)}
                    className="w-full flex items-center gap-2.5 px-1.5 py-1 rounded hover:bg-white/5 transition-colors text-left"
                  >
                    <span
                      className={`w-3 h-3 rounded-full flex-shrink-0 border ${timeLayer === o.key ? 'bg-[var(--gold-primary)] border-[var(--gold-primary)]' : 'border-white/30'}`}
                    />
                    <span className={`text-[11px] font-mono ${timeLayer === o.key ? 'text-white' : 'text-white/60'}`}>
                      {o.key === 'ortho-year' ? `${o.label} · ${orthoYear}` : o.label}
                    </span>
                  </button>
                  {/* Curseur d'année, visible seulement quand l'ortho annuelle est active */}
                  {o.key === 'ortho-year' && timeLayer === 'ortho-year' && (
                    <div className="pl-[22px] pr-1 pt-1.5 pb-1">
                      <input
                        type="range"
                        min={ORTHO_YEAR_MIN}
                        max={ORTHO_YEAR_MAX}
                        step={1}
                        value={orthoYear}
                        onChange={(e) => setOrthoYear(Number(e.target.value))}
                        className="w-full accent-[var(--gold-primary)] cursor-pointer"
                      />
                      <div className="flex justify-between text-[8px] font-mono text-[var(--text-muted)] tabular-nums mt-0.5">
                        <span>{ORTHO_YEAR_MIN}</span>
                        <span className="text-[var(--gold-primary)] text-[10px]">{orthoYear}</span>
                        <span>{ORTHO_YEAR_MAX}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* SURCOUCHES (checkboxes) */}
          <div>
            <div className="text-[9px] font-mono tracking-widest text-[var(--cyan-primary)] uppercase mb-2 pb-1 border-b border-white/10">Surcouches</div>
            <div className="flex flex-col gap-1">
              {OVERLAY_OPTS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => toggleOverlay(o.key)}
                  className="flex items-center gap-2.5 px-1.5 py-1 rounded hover:bg-white/5 transition-colors text-left"
                >
                  <span
                    className={`w-3 h-3 rounded-sm flex-shrink-0 border flex items-center justify-center ${overlays[o.key] ? 'bg-[var(--gold-primary)] border-[var(--gold-primary)]' : 'border-white/30'}`}
                  >
                    {overlays[o.key] && <span className="w-1.5 h-1.5 bg-[var(--bg-void)] rounded-[1px]" />}
                  </span>
                  <span className={`text-[11px] font-mono ${overlays[o.key] ? 'text-white' : 'text-white/60'}`}>{o.label}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── CONTRÔLES CARTE (globe/2D + menu couches + recentrage FR) ── */}
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
          onClick={() => setLayersOpen((v) => !v)}
          className={`glass-panel px-3 py-2.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors flex items-center gap-2 text-[9px] font-mono tracking-widest ${layersOpen || timeLayer !== 'none' || mapStyle !== 'dark' || Object.values(overlays).some(Boolean) ? 'text-[var(--gold-primary)] border-[var(--gold-primary)]/50' : 'text-[var(--cyan-primary)]'}`}
          title="Menu des couches (fonds, remonter le temps, surcouches)"
        >
          <Layers className="w-4 h-4" />
          COUCHES
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
