'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Globe, MapPinned, Layers, X } from 'lucide-react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { search, buildMapData, BASE_PATH, type SearchResponse, type PlotPoint } from '@/lib/api';
import { useDataPolling, useInterpolation, deadReckon } from '@/lib/liveData';
import { useDataKey } from '@/lib/store';
import type { AircraftPoint, QuakePoint, FirePoint, VolcanoPoint, SatellitePoint, ShipPoint, SensitiveData, SensitivePoint, GeoEventPoint, CyberPoint } from '@/components/OsirisMap';
import { OSIRIS_VERSION, OSIRIS_VERSION_LABEL } from '@/lib/version';
import { useAlertToasts } from '@/lib/alerts';
import AlertToasts from '@/components/AlertToasts';
import { useRegionDossier } from '@/lib/regionDossier';
import RegionDossierPanel from '@/components/RegionDossierPanel';
import { enrichAircraft, type AircraftEnriched } from '@/lib/entityEnrich';
import EntityCard from '@/components/EntityCard';
import StreamViewer, { type StreamSource } from '@/components/StreamViewer';
import { type VisualMode, nextMode, getVisualMode } from '@/lib/visualModes';
import VisualModeOverlay from '@/components/VisualModeOverlay';
import { isForm2Enabled, hasConsented, giveConsent } from '@/lib/forms';
import ConsentModal from '@/components/ConsentModal';
import { applyFilter, DEFAULT_FILTERS, type LayerFilters } from '@/lib/layerFilters';
import { useKeyboardShortcuts } from '@/lib/shortcuts';
import type { ViewPreset } from '@/lib/viewPresets';
import { buildShareUrl, copyShareUrl } from '@/lib/shareLink';

// Cockpit servi sous basePath (/cockpit) → l'utilisateur arrive DÉJÀ loggué via la
// V3 (cookie httponly même-domaine couvre /search). Dans ce mode on court-circuite
// le LoginGate V4 et, sur 401, on renvoie vers le login V3 à la racine (`/login`).
const COCKPIT_MODE = BASE_PATH !== '';

// Accueil = TOUJOURS la racine du MÊME site (la landing qui porte le bouton
// « Cockpit carte »). On ne saute JAMAIS vers un autre domaine, sinon on tombe
// sur un site sans carte. `<a href="/">` vise la racine du domaine courant
// (Next ne réécrit PAS le basePath sur les <a> natifs) → depuis /cockpit,
// « ← Accueil » ramène bien à la page d'accueil du même domaine.

const OsirisMap = dynamic(() => import('@/components/OsirisMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));
const SearchBar = dynamic(() => import('@/components/SearchBar'), { ssr: false });
const ResultsPanel = dynamic(() => import('@/components/ResultsPanel'), { ssr: false });
const LoginGate = dynamic(() => import('@/components/LoginGate'), { ssr: false });
const OsintPanel = dynamic(() => import('@/components/OsintPanel'), { ssr: false });
const KeysPanel = dynamic(() => import('@/components/KeysPanel'), { ssr: false });
const EntityGraphPanel = dynamic(() => import('@/components/EntityGraphPanel'), { ssr: false });
const NewsPanel = dynamic(() => import('@/components/NewsPanel'), { ssr: false });
const FilterPanel = dynamic(() => import('@/components/FilterPanel'), { ssr: false });
// ⏸️ Briefing IA mis de côté (demande Cissou 05/07) : fichiers conservés dormants
// (BriefingPanel / analyzeClient / route /analyze), débranchés de l'UI. Réactivation
// = remonter l'import + l'outil sidebar + le montage + getBriefingContext.
import CockpitSidebar from '@/components/CockpitSidebar';
import ComfortBar from '@/components/ComfortBar';

// Couches FR (stub) — clés canoniques partagées avec LayerPanel + OsirisMap.
const DEFAULT_LAYERS: Record<string, boolean> = {
  fr_entreprises: false,
  fr_bodacc: false,
  fr_dvf: false,
  fr_ban: false,
  fr_rna: false,
  day_night: false,
  live_aircraft: false,
  live_earthquakes: false,
  live_wildfires: false,
  live_volcanoes: false,
  live_satellites: false,
  live_ships: false,
  live_gdelt: false,
  live_cyber: false,
  // Couches sensibles (forme 2) — jamais actives par défaut.
  sens_military_bases: false,
  sens_cctv: false,
  sens_gps_jamming: false,
  sens_scanners: false,
  sens_sigint: false,
  sens_telegram_osint: false,
};

// Clés des couches temps réel « publiques » (forme 1) — gating du polling fast/slow.
const LIVE_LAYER_KEYS = ['live_aircraft', 'live_earthquakes', 'live_wildfires', 'live_volcanoes', 'live_satellites', 'live_ships', 'live_gdelt', 'live_cyber'];
// Clés des couches sensibles (forme 2) — gating du polling /live-feed/sensitive.
const SENSITIVE_LAYER_KEYS = ['sens_military_bases', 'sens_cctv', 'sens_gps_jamming', 'sens_scanners', 'sens_sigint', 'sens_telegram_osint'];

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
// Couches temps réel (checkboxes) — clé = clé activeLayers, title = infobulle FR.
const LIVE_OPTS: { key: string; label: string; title: string }[] = [
  { key: 'live_aircraft', label: 'Avions ✈ (adsb.lol)', title: 'Avions en vol — ADS-B public (adsb.lol), actualisé 15 s' },
  { key: 'live_earthquakes', label: 'Séismes (USGS)', title: 'Séismes des dernières 24 h — USGS public, actualisé 120 s' },
  { key: 'live_wildfires', label: 'Feux (FIRMS)', title: 'Foyers actifs — NASA FIRMS (nécessite une clé FIRMS_MAP_KEY)' },
  { key: 'live_volcanoes', label: 'Volcans', title: 'Volcans — à brancher (Smithsonian GVP)' },
  { key: 'live_satellites', label: 'Satellites 🛰', title: 'Satellites notables (celestrak + calcul SGP4, public sans clé)' },
  { key: 'live_ships', label: 'Navires 🚢', title: 'Navires AIS — nécessite une source/clé AIS (AIS_REST_URL)' },
  { key: 'live_gdelt', label: 'Géopolitique 🌍', title: 'Événements mondiaux géolocalisés — GDELT public, sans clé' },
  { key: 'live_cyber', label: 'Cyber (C2) 🛡️', title: 'Serveurs C2 malware — abuse.ch public, sans clé (veille défensive)' },
];
// Couches sensibles (forme 2 — enquêteur, opt-in + consentement, cadre ARPD).
const SENSITIVE_OPTS: { key: string; label: string; title: string }[] = [
  { key: 'sens_military_bases', label: 'Bases militaires', title: 'Bases militaires — OpenStreetMap/Overpass (public, sans clé)' },
  { key: 'sens_cctv', label: 'Caméras 🔴', title: 'Caméras publiques (flux in-app) — LIGNE ROUGE ARPD, nécessite une clé' },
  { key: 'sens_gps_jamming', label: 'Brouillage GPS', title: 'Zones de brouillage GPS — nécessite une clé' },
  { key: 'sens_scanners', label: 'Scanners', title: 'Scanners radio — nécessite une clé' },
  { key: 'sens_sigint', label: 'SIGINT (mesh/APRS)', title: 'Radio mesh / APRS — nécessite une clé' },
  { key: 'sens_telegram_osint', label: 'Telegram OSINT', title: 'Signaux Telegram géolocalisés — nécessite une clé' },
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

  // Dernière requête lancée — sert à la continuité V3 ⇄ cockpit (lien retour ?q=).
  const [lastQuery, setLastQuery] = useState('');
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

  // ── Couches temps réel (avions, séismes, feux, volcans) ──
  // Le polling ne tourne QUE si AU MOINS une couche live est allumée (économie
  // réseau + respect des sources gratuites). Le moteur interroge /fast (15 s :
  // avions) et /slow (120 s : géophysique) et merge dans le store par-clé.
  const anyLiveOn = LIVE_LAYER_KEYS.some((k) => activeLayers[k]);
  useDataPolling({ enabled: anyLiveOn });
  const aircraft = useDataKey<AircraftPoint[]>('aircraft');
  const earthquakes = useDataKey<QuakePoint[]>('earthquakes');
  const wildfires = useDataKey<FirePoint[]>('wildfires');
  const volcanoes = useDataKey<VolcanoPoint[]>('volcanoes');
  const satellites = useDataKey<SatellitePoint[]>('satellites');
  const ships = useDataKey<ShipPoint[]>('ships');
  const gdelt = useDataKey<GeoEventPoint[]>('gdelt');
  const cyber = useDataKey<CyberPoint[]>('cyber');

  // ── Couches sensibles (forme 2) — polling séparé /live-feed/sensitive,
  // actif UNIQUEMENT en forme 2 ET si une couche sensible est allumée. ──
  const form2 = isForm2Enabled();
  const anySensitiveOn = form2 && SENSITIVE_LAYER_KEYS.some((k) => activeLayers[k]);
  useDataPolling({
    fastUrl: '/live-feed/sensitive', slowUrl: '/live-feed/sensitive', criticalUrl: '/live-feed/sensitive',
    fastIntervalMs: 120000, slowIntervalMs: 3_600_000, denseEndpoints: [], enabled: anySensitiveOn,
  });
  const s_cctv = useDataKey<SensitivePoint[]>('cctv');
  const s_military = useDataKey<SensitivePoint[]>('military_bases');
  const s_jamming = useDataKey<SensitivePoint[]>('gps_jamming');
  const s_scanners = useDataKey<SensitivePoint[]>('scanners');
  const s_sigint = useDataKey<SensitivePoint[]>('sigint');
  const s_telegram = useDataKey<SensitivePoint[]>('telegram_osint');
  const sensitive: SensitiveData = useMemo(() => ({
    cctv: s_cctv, military_bases: s_military, gps_jamming: s_jamming,
    scanners: s_scanners, sigint: s_sigint, telegram_osint: s_telegram,
  }), [s_cctv, s_military, s_jamming, s_scanners, s_sigint, s_telegram]);

  // ── Carte-fiche entité (clic avion) : affichage immédiat puis photo ──
  const [selectedEntity, setSelectedEntity] = useState<AircraftEnriched | null>(null);
  const handleAircraftClick = useCallback((a: AircraftPoint) => {
    setSelectedEntity({ ...a, photo: null, socials: [] } as AircraftEnriched);
    enrichAircraft(a).then(setSelectedEntity).catch(() => {});
  }, []);

  // ── Lecteur de flux in-app (clic webcam/CCTV) ──
  const [activeStream, setActiveStream] = useState<StreamSource | null>(null);

  // ── Modes visuels (CRT / NVG / thermique) ──
  const [visualMode, setVisualMode] = useState<VisualMode>('normal');

  // ── Panneaux ouvrables depuis la sidebar ──
  const [osintOpen, setOsintOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);

  // ── Filtres d'attributs (filtrer DANS une couche affichée) ──
  const [filters, setFilters] = useState<LayerFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // ── Retour visuel « lien copié » (bouton Partager de la ComfortBar) ──
  const [shareToast, setShareToast] = useState(false);

  // ── Consentement forme 2 : au 1er toggle d'une couche sensible, si pas
  // encore consenti → modale. Sur accord → consentement + activation. ──
  const [askConsent, setAskConsent] = useState(false);
  const pendingSensitiveRef = useRef<string | null>(null);
  const toggleSensitive = useCallback((key: string) => {
    if (!hasConsented()) {
      pendingSensitiveRef.current = key;
      setAskConsent(true);
      return;
    }
    setActiveLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Interpolation avions (mouvement fluide entre 2 fetches, façon radar live) ──
  // Le fetch avions arrive toutes les 15 s ; entre-temps on estime la position
  // par dead-reckoning (cap + vitesse) toutes les 2 s → les avions glissent au
  // lieu de sauter. On repart TOUJOURS de la dernière position réelle connue
  // (baseline) + temps écoulé → pas d'accumulation d'erreur. 1 nœud = 0,5144 m/s.
  const [displayAircraft, setDisplayAircraft] = useState<AircraftPoint[]>([]);
  const aircraftBaseRef = useRef<{ data: AircraftPoint[]; t: number }>({ data: [], t: 0 });
  useEffect(() => {
    if (!aircraft) return;
    aircraftBaseRef.current = { data: aircraft, t: Date.now() };
    setDisplayAircraft(aircraft);
  }, [aircraft]);
  useInterpolation(() => {
    const base = aircraftBaseRef.current;
    if (!base.data.length) return;
    const elapsed = (Date.now() - base.t) / 1000; // s depuis le dernier fetch réel
    setDisplayAircraft(
      base.data.map((a) => {
        if (typeof a.heading !== 'number' || typeof a.speed !== 'number' || a.speed <= 0) return a;
        const m = deadReckon({ ...a, lat: a.lat, lng: a.lng, heading: a.heading, speedMps: a.speed * 0.514444 }, elapsed);
        return { ...a, lat: m.lat, lng: m.lng };
      }),
    );
  }, { enabled: !!activeLayers.live_aircraft });

  // ── Alertes toasts (seuil séisme + apparition VIP) ──
  // Le hook surveille le store et génère des alertes FR anti-doublon.
  const { alerts, dismiss } = useAlertToasts();

  // ── Dossier de zone au clic droit (Nominatim / restcountries / Wikidata) ──
  const { dossier, loading: dossierLoading, error: dossierError, open: openDossier, close: closeDossier } = useRegionDossier();

  // ── Filtres d'attributs : on filtre les points AVANT de les passer à la carte.
  // applyFilter est pur et tolérant (null/undefined → renvoyé tel quel) ; sans
  // critère actif pour la couche → tableau inchangé (aucun surcoût perceptible). ──
  const fAircraft = useMemo(() => applyFilter('aircraft', displayAircraft, filters), [displayAircraft, filters]);
  const fEarthquakes = useMemo(() => applyFilter('earthquakes', earthquakes ?? [], filters), [earthquakes, filters]);
  const fShips = useMemo(() => applyFilter('ships', ships ?? [], filters), [ships, filters]);
  const fGdelt = useMemo(() => applyFilter('gdelt', gdelt ?? [], filters), [gdelt, filters]);
  const fCyber = useMemo(() => applyFilter('cyber', cyber ?? [], filters), [cyber, filters]);

  // ── Partage : encode l'état carte (couches actives + requête) dans un lien,
  // copie dans le presse-papier, feedback « Lien copié » éphémère. ──
  const handleShare = useCallback(async () => {
    const active = Object.entries(activeLayers).filter(([, v]) => v).map(([k]) => k);
    const url = buildShareUrl({ layers: active, q: lastQuery || undefined });
    const ok = await copyShareUrl(url);
    setShareToast(ok);
    setTimeout(() => setShareToast(false), 1800);
  }, [activeLayers, lastQuery]);

  const handleSelectPreset = useCallback((p: ViewPreset) => {
    setFlyToLocation({ lat: p.lat, lng: p.lng, ts: Date.now() });
  }, []);

  // ── Raccourcis clavier (c/r/o/t/v/p/Échap) — cf. lib/shortcuts.ts. Objet
  // mémoïsé pour éviter de ré-attacher l'écouteur à chaque rendu. ──
  const shortcutHandlers = useMemo(() => ({
    onToggleLayers: () => setLayersOpen((v) => !v),
    onRecenterFR: () => setFlyToLocation({ lat: 46.6, lng: 2.35, ts: Date.now() }),
    onOpenOsint: () => setOsintOpen(true),
    onOpenFilters: () => setFilterOpen((v) => !v),
    onCycleVisual: () => setVisualMode((m) => nextMode(m)),
    onShare: () => { void handleShare(); },
    onEscape: () => {
      setLayersOpen(false); setFilterOpen(false); setOsintOpen(false); setKeysOpen(false);
      setGraphOpen(false); setNewsOpen(false);
    },
  }), [handleShare]);
  useKeyboardShortcuts(shortcutHandlers);

  // ── Recherche cible (search-first) : appelle le backend puis plotte ──
  const runSearch = useCallback(async (q: string) => {
    setLastQuery(q);
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

  // Continuité V3 → cockpit : si on arrive avec ?q= (lien "Cockpit carte" de la V3),
  // on relance la même recherche à l'arrivée → la carte/les résultats suivent.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) runSearch(q);
  }, [runSearch]);

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

  // Clic droit sur la carte → ouvre le dossier de zone (données publiques :
  // géocodage inverse FR, pays, gouvernance Wikidata).
  const handleRightClick = useCallback((coords: { lat: number; lng: number }) => {
    openDossier(coords);
  }, [openDossier]);

  // Écran d'accès tant que non authentifié (null = check en cours → rien).
  if (authed === null) return <main className="fixed inset-0 bg-[var(--bg)]" />;
  if (!authed) return <LoginGate onAuthed={handleAuthed} />;

  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg)] overflow-hidden">
      {/* ── ZONE CONTENU PLEIN ÉCRAN : la CARTE occupe TOUT le fond. La sidebar
          (plus bas) flotte PAR-DESSUS en verre translucide → la carte transparaît
          à travers elle (pas de fond ajouté : le fond, c'est la carte elle-même). ── */}
      <div className="relative w-full h-full overflow-hidden">
      {/* ── CARTE ── */}
      <ErrorBoundary name="Carte">
        <OsirisMap
          data={data}
          activeLayers={activeLayers}
          aircraft={fAircraft}
          earthquakes={fEarthquakes}
          wildfires={wildfires}
          volcanoes={volcanoes}
          satellites={satellites}
          ships={fShips}
          gdelt={fGdelt}
          cyber={fCyber}
          sensitive={sensitive}
          onAircraftClick={handleAircraftClick}
          onStreamClick={setActiveStream}
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

      {/* ── BOUTON RETOUR ACCUEIL (desktop) — réintégré à la demande de Cissou,
          en plus du lien Accueil de la sidebar (accès rapide flottant). ── */}
      {!isMobile && (
        <a
          href={lastQuery ? `/?q=${encodeURIComponent(lastQuery)}` : '/'}
          className="absolute top-4 left-[252px] z-[210] glass-panel hover-lift pointer-events-auto rounded-[12px] px-3 py-1.5 text-[10px] font-mono tracking-widest text-[var(--accent-bright)] hover:text-[var(--accent)] transition-colors"
          title="Retour à l'accueil"
        >
          ← Accueil
        </a>
      )}

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

      {/* ── ALERTES (toasts temps réel : séismes, VIP) ── */}
      <AlertToasts
        alerts={alerts}
        onDismiss={dismiss}
        onFlyTo={({ lat, lng }) => setFlyToLocation({ lat, lng, ts: Date.now() })}
      />

      {/* ── DOSSIER DE ZONE (clic droit sur la carte) ── */}
      {(dossier || dossierLoading) && (
        <ErrorBoundary name="Dossier de zone">
          <RegionDossierPanel
            dossier={dossier}
            loading={dossierLoading}
            error={dossierError}
            onClose={closeDossier}
            isMobile={isMobile}
          />
        </ErrorBoundary>
      )}

      {/* ── CARTE-FICHE ENTITÉ (clic avion : photo + détails) ── */}
      {selectedEntity && (
        <ErrorBoundary name="Fiche entité">
          <EntityCard
            entity={selectedEntity}
            onClose={() => setSelectedEntity(null)}
            onFlyTo={(loc) => setFlyToLocation({ lat: loc.lat, lng: loc.lng, ts: Date.now() })}
            isMobile={isMobile}
          />
        </ErrorBoundary>
      )}

      {/* ── LECTEUR DE FLUX IN-APP (clic webcam/CCTV) ── */}
      {activeStream && (
        <ErrorBoundary name="Lecteur de flux">
          <StreamViewer
            source={activeStream}
            onClose={() => setActiveStream(null)}
            onFlyTo={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })}
            isMobile={isMobile}
          />
        </ErrorBoundary>
      )}

      {/* ── PANNEAU OSINT (boîte à outils d'investigation) ── */}
      {osintOpen && (
        <ErrorBoundary name="OSINT">
          <OsintPanel onClose={() => setOsintOpen(false)} isMobile={isMobile} />
        </ErrorBoundary>
      )}

      {/* ── GRAPHE D'ENTITÉS ── */}
      {graphOpen && (
        <ErrorBoundary name="Graphe d'entités">
          <EntityGraphPanel onClose={() => setGraphOpen(false)} />
        </ErrorBoundary>
      )}

      {/* ── FIL D'ACTUALITÉ (News GDELT) ── */}
      {newsOpen && (
        <ErrorBoundary name="News">
          <NewsPanel onClose={() => setNewsOpen(false)} isMobile={isMobile} />
        </ErrorBoundary>
      )}

      {/* ── FILTRES DE COUCHE (filtrer DANS une couche affichée) ── */}
      {filterOpen && (
        <ErrorBoundary name="Filtres">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            onClose={() => setFilterOpen(false)}
            activeLayers={activeLayers}
            isMobile={isMobile}
          />
        </ErrorBoundary>
      )}

      {/* ── MODULE CLÉS API ── */}
      {keysOpen && (
        <ErrorBoundary name="Clés API">
          <KeysPanel onClose={() => setKeysOpen(false)} />
        </ErrorBoundary>
      )}

      {/* ── MODE VISUEL (overlay CRT / NVG / thermique) ── */}
      <VisualModeOverlay mode={visualMode} />

      {/* ── CONSENTEMENT FORME 2 (couches sensibles) ── */}
      <ConsentModal
        open={askConsent}
        onAccept={() => {
          giveConsent();
          setAskConsent(false);
          const k = pendingSensitiveRef.current;
          pendingSensitiveRef.current = null;
          if (k) setActiveLayers((prev) => ({ ...prev, [k]: true }));
        }}
        onCancel={() => { setAskConsent(false); pendingSensitiveRef.current = null; }}
      />

      {/* ── EN-TÊTE (mobile uniquement — sur desktop c'est la sidebar qui porte
          la marque + la nav + la version) ── */}
      {isMobile && (
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="absolute top-4 z-[200] pointer-events-none flex flex-col"
        style={{ left: '16px', right: '16px' }}
      >
        <div className="flex items-center gap-3 w-fit">
          {/* Lien retour vers la V3 (racine du domaine) — visible seulement sous /cockpit.
              Anchor natif (pas next/link) → href '/' non préfixé par basePath = racine V3. */}
          {/* Bouton retour accueil — TOUJOURS visible. En mode /cockpit il garde
              la continuité de recherche (?q=) ; sinon il renvoie vers la V3. */}
          <a
            href={lastQuery ? `/?q=${encodeURIComponent(lastQuery)}` : '/'}
            /* Pill arrondie + léger décollement au survol (langage boutons de la landing) */
            className="glass-panel hover-lift pointer-events-auto rounded-[12px] px-3 py-1 text-[10px] font-mono tracking-widest text-[var(--accent-bright)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors"
            title="Retour à l'accueil"
          >
            ← Accueil
          </a>
          <h1 className="text-lg md:text-xl font-bold tracking-[0.4em] text-[var(--accent)] font-mono">OSIRIS</h1>
          <span className="text-[8px] md:text-[9px] font-mono tracking-[0.2em] opacity-70 uppercase text-[var(--accent)]">
            {OSIRIS_VERSION_LABEL} · {OSIRIS_VERSION}
          </span>
        </div>
      </motion.div>
      )}

      {/* ── PANNEAU MENU DE COUCHES (dépliable, au-dessus du bouton COUCHES) ── */}
      {layersOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-panel absolute z-[210] pointer-events-auto p-4 w-[248px] overflow-y-auto"
          style={{
            left: isMobile ? '12px' : '252px',
            bottom: isMobile ? '128px' : '153px',
            maxHeight: 'min(62vh, 520px)',
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-mono font-bold tracking-widest text-[var(--accent)]">COUCHES</span>
            <button
              onClick={() => setLayersOpen(false)}
              className="text-[var(--faint)] hover:text-[var(--accent)] transition-colors"
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* FONDS (radio) */}
          <div className="mb-4">
            <div className="text-[9px] font-mono tracking-widest text-[var(--accent-bright)] uppercase mb-2 pb-1 border-b border-white/10">Fond de carte</div>
            <div className="flex flex-col gap-1">
              {BASEMAP_OPTS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setMapStyle(o.key)}
                  /* Rangée sélectionnable : fond accent-soft + bordure accent quand active (landing) */
                  className={`osiris-row flex items-center gap-2.5 px-2 py-1.5 text-left ${mapStyle === o.key ? 'osiris-row-active' : ''}`}
                >
                  <span
                    className={`w-3 h-3 rounded-full flex-shrink-0 border ${mapStyle === o.key ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-white/30'}`}
                  />
                  <span className={`text-[11px] font-mono ${mapStyle === o.key ? 'text-white' : 'text-white/60'}`}>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* REMONTER LE TEMPS (radio + curseur d'année) */}
          <div className="mb-4">
            <div className="text-[9px] font-mono tracking-widest text-[var(--accent-bright)] uppercase mb-2 pb-1 border-b border-white/10">Remonter le temps</div>
            <div className="flex flex-col gap-1">
              {TIME_OPTS.map((o) => (
                <div key={o.key}>
                  <button
                    onClick={() => setTimeLayer(o.key)}
                    className={`osiris-row w-full flex items-center gap-2.5 px-2 py-1.5 text-left ${timeLayer === o.key ? 'osiris-row-active' : ''}`}
                  >
                    <span
                      className={`w-3 h-3 rounded-full flex-shrink-0 border ${timeLayer === o.key ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-white/30'}`}
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
                        className="w-full accent-[var(--accent)] cursor-pointer"
                      />
                      <div className="flex justify-between text-[8px] font-mono text-[var(--faint)] tabular-nums mt-0.5">
                        <span>{ORTHO_YEAR_MIN}</span>
                        <span className="text-[var(--accent)] text-[10px]">{orthoYear}</span>
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
            <div className="text-[9px] font-mono tracking-widest text-[var(--accent-bright)] uppercase mb-2 pb-1 border-b border-white/10">Surcouches</div>
            <div className="flex flex-col gap-1">
              {OVERLAY_OPTS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => toggleOverlay(o.key)}
                  className={`osiris-row flex items-center gap-2.5 px-2 py-1.5 text-left ${overlays[o.key] ? 'osiris-row-active' : ''}`}
                >
                  <span
                    className={`w-3 h-3 rounded-sm flex-shrink-0 border flex items-center justify-center ${overlays[o.key] ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-white/30'}`}
                  >
                    {overlays[o.key] && <span className="w-1.5 h-1.5 bg-[var(--bg)] rounded-[1px]" />}
                  </span>
                  <span className={`text-[11px] font-mono ${overlays[o.key] ? 'text-white' : 'text-white/60'}`}>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* TEMPS RÉEL (couches live — données publiques) */}
          <div className="mt-4">
            <div className="text-[9px] font-mono tracking-widest text-[var(--accent-bright)] uppercase mb-2 pb-1 border-b border-white/10">Temps réel</div>
            <div className="flex flex-col gap-1">
              {LIVE_OPTS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setActiveLayers((prev) => ({ ...prev, [o.key]: !prev[o.key] }))}
                  className={`osiris-row flex items-center gap-2.5 px-2 py-1.5 text-left ${activeLayers[o.key] ? 'osiris-row-active' : ''}`}
                  title={o.title}
                >
                  <span
                    className={`w-3 h-3 rounded-sm flex-shrink-0 border flex items-center justify-center ${activeLayers[o.key] ? 'bg-[var(--accent)] border-[var(--accent)]' : 'border-white/30'}`}
                  >
                    {activeLayers[o.key] && <span className="w-1.5 h-1.5 bg-[var(--bg)] rounded-[1px]" />}
                  </span>
                  <span className={`text-[11px] font-mono ${activeLayers[o.key] ? 'text-white' : 'text-white/60'}`}>{o.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* SENSIBLES (forme 2 — enquêteur, opt-in + consentement). Affiché
              UNIQUEMENT si le build est en forme 2 (NEXT_PUBLIC_OSIRIS_FORM=2). */}
          {form2 && (
            <div className="mt-4">
              <div className="text-[9px] font-mono tracking-widest text-[var(--red)] uppercase mb-2 pb-1 border-b border-[var(--red)]/25">Sensibles · forme 2</div>
              <div className="flex flex-col gap-1">
                {SENSITIVE_OPTS.map((o) => (
                  <button
                    key={o.key}
                    onClick={() => toggleSensitive(o.key)}
                    className={`osiris-row flex items-center gap-2.5 px-2 py-1.5 text-left ${activeLayers[o.key] ? 'osiris-row-active' : ''}`}
                    title={o.title}
                  >
                    <span className={`w-3 h-3 rounded-sm flex-shrink-0 border flex items-center justify-center ${activeLayers[o.key] ? 'bg-[var(--red)] border-[var(--red)]' : 'border-white/30'}`}>
                      {activeLayers[o.key] && <span className="w-1.5 h-1.5 bg-[var(--bg)] rounded-[1px]" />}
                    </span>
                    <span className={`text-[11px] font-mono ${activeLayers[o.key] ? 'text-white' : 'text-white/60'}`}>{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {/* ── CONTRÔLES CARTE (globe/2D + menu couches + recentrage FR) ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="absolute bottom-[75px] md:bottom-[100px] z-[200] flex items-center gap-2 pointer-events-none"
        style={{ left: isMobile ? '12px' : '252px' }}
      >
        <button
          onClick={() => setMapProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          /* Bouton icône rond + hover lift (pills de la landing) */
          className="glass-panel hover-lift rounded-[12px] p-3.5 pointer-events-auto hover:border-[var(--accent)]/40 transition-colors group"
          title={mapProjection === 'globe' ? 'Vue 2D' : 'Vue Globe 3D'}
        >
          {mapProjection === 'globe'
            ? <MapPinned className="w-5 h-5 text-[var(--accent)] group-hover:scale-110 transition-transform" />
            : <Globe className="w-5 h-5 text-[var(--accent-bright)] group-hover:scale-110 transition-transform" />}
        </button>
        <button
          onClick={() => setLayersOpen((v) => !v)}
          /* Pill COUCHES arrondie + hover lift ; actif = bordure accent (état .chip.active) */
          className={`glass-panel hover-lift rounded-[12px] px-3.5 py-2.5 pointer-events-auto hover:border-[var(--accent)]/40 transition-colors flex items-center gap-2 text-[9px] font-mono tracking-widest ${layersOpen || timeLayer !== 'none' || mapStyle !== 'dark' || Object.values(overlays).some(Boolean) || anyLiveOn ? 'text-[var(--accent)] border-[var(--accent)]/50 bg-[var(--accent-soft)]' : 'text-[var(--accent-bright)]'}`}
          title="Menu des couches (fonds, remonter le temps, surcouches)"
        >
          <Layers className="w-4 h-4" />
          COUCHES
        </button>
        <button
          onClick={() => setFlyToLocation({ lat: 46.6, lng: 2.35, ts: Date.now() })}
          /* Pill FR arrondie + hover lift */
          className="glass-panel hover-lift rounded-[12px] px-3.5 py-2 pointer-events-auto hover:border-[var(--accent)]/40 transition-colors text-[9px] font-mono tracking-widest text-[var(--accent)]"
          title="Recentrer sur la France"
        >
          FR
        </button>
        {/* Cycle des modes visuels (normal → CRT → NVG → thermique) */}
        <button
          onClick={() => setVisualMode((m) => nextMode(m))}
          className={`glass-panel hover-lift rounded-[12px] px-3.5 py-2 pointer-events-auto hover:border-[var(--accent)]/40 transition-colors text-[9px] font-mono tracking-widest ${visualMode !== 'normal' ? 'text-[var(--accent)] border-[var(--accent)]/50' : 'text-[var(--accent-bright)]'}`}
          title={`Mode visuel : ${getVisualMode(visualMode)?.label ?? 'Normal'} (cliquer pour changer)`}
        >
          {(getVisualMode(visualMode)?.label ?? 'Normal').toUpperCase()}
        </button>
        {/* Boîte à outils OSINT (whois, dns, ip, cve, leaks, shodan…) */}
        <button
          onClick={() => setOsintOpen(true)}
          className={`glass-panel hover-lift rounded-[12px] px-3.5 py-2 pointer-events-auto hover:border-[var(--accent)]/40 transition-colors text-[9px] font-mono tracking-widest ${osintOpen ? 'text-[var(--accent)] border-[var(--accent)]/50' : 'text-[var(--accent-bright)]'}`}
          title="Boîte à outils OSINT (whois, DNS, IP, CVE, fuites, Shodan…)"
        >
          🔍 OSINT
        </button>
        {/* Filtres d'attributs (filtrer DANS une couche temps réel active) */}
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={`glass-panel hover-lift rounded-[12px] px-3.5 py-2 pointer-events-auto hover:border-[var(--accent)]/40 transition-colors text-[9px] font-mono tracking-widest ${filterOpen ? 'text-[var(--accent)] border-[var(--accent)]/50 bg-[var(--accent-soft)]' : 'text-[var(--accent-bright)]'}`}
          title="Filtres de couche (altitude, magnitude, malware… — touche T)"
        >
          🎚️ FILTRES
        </button>
        {/* Confort : Vues prédéfinies · Partager le lien · Aide raccourcis */}
        <ComfortBar onSelectPreset={handleSelectPreset} onShare={() => { void handleShare(); }} isMobile={isMobile} />
      </motion.div>

      {/* ── TOAST « LIEN COPIÉ » (retour visuel du bouton Partager) ── */}
      {shareToast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-[130px] md:bottom-[155px] left-1/2 -translate-x-1/2 z-[230] pointer-events-none glass-panel px-3 py-1.5 rounded-[12px] text-[10px] font-mono tracking-widest text-[var(--accent)]"
        >
          ✓ Lien copié
        </motion.div>
      )}

      {/* ── BARRE COORDONNÉES (bas) ── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[200] pointer-events-none flex items-center gap-3 text-[9px] font-mono tracking-widest text-[var(--faint)] glass-panel px-3 py-1.5">
        <div ref={coordsDisplayRef} className="text-[var(--accent-bright)] tabular-nums">--.----, --.----</div>
        {locationLabel && <span className="text-[var(--muted)] truncate max-w-[40vw]">{locationLabel}</span>}
      </div>
      </div>{/* /zone contenu */}

      {/* ── SIDEBAR APP — FLOTTE par-dessus la carte (verre translucide, position
          absolue via .ck-sidenav). La carte passe sous elle et transparaît à
          travers le blur → vraie transparence, sans fond ajouté. Barre figée :
          « Cockpit carte » actif, liens vers les onglets de l'accueil. ── */}
      {!isMobile && (
        <CockpitSidebar
          version={OSIRIS_VERSION}
          onOpenOsint={() => setOsintOpen(true)}
          onOpenGraph={() => setGraphOpen(true)}
          onOpenNews={() => setNewsOpen(true)}
          onOpenKeys={() => setKeysOpen(true)}
        />
      )}
    </main>
  );
}
