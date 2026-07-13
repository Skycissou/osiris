'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import { Globe, MapPinned, Layers, X } from 'lucide-react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { search, buildMapData, BASE_PATH, type SearchResponse, type PlotPoint } from '@/lib/api';
import { useDataPolling, useInterpolation, deadReckon } from '@/lib/liveData';
import { useDataKey } from '@/lib/store';
import type { AircraftPoint, QuakePoint, FirePoint, VolcanoPoint, SatellitePoint, ShipPoint, SensitiveData, SensitivePoint, GeoEventPoint, CyberPoint, AlertPoint } from '@/components/OsirisMap';
import { AIRCRAFT_CAT_COLORS, AIRCRAFT_CAT_LABELS, AIRCRAFT_CAT_ORDER } from '@/components/OsirisMap';
import { OSIRIS_VERSION, OSIRIS_VERSION_LABEL } from '@/lib/version';
import { useAlertToasts } from '@/lib/alerts';
import AlertToasts from '@/components/AlertToasts';
import AlertsControlBar, { type AlertsHealth } from '@/components/AlertsControlBar';
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
import type { SpotlightRegion } from '@/lib/spotlightMasks';
import { isInRegion } from '@/lib/spotlightMasks';
import { buildShareUrl, copyShareUrl } from '@/lib/shareLink';
import DebugCapsule from '@/components/DebugCapsule';
import OsirisDiagView from '@/components/OsirisDiagView';

// Cockpit servi sous basePath (/cockpit) → l'utilisateur arrive DÉJÀ loggué via la
// V3 (cookie httponly même-domaine couvre /search). Dans ce mode on court-circuite
// le LoginGate V4 et, sur 401, on renvoie vers le login V3 à la racine (`/login`).
const COCKPIT_MODE = BASE_PATH !== '';

// 🔓 BYPASS AUTH (DEV) — demande Cissou 13/07 : tant que la session comptes/auth
//  n'est pas faite (jalon Émancipation Lot C), on GARDE la page de connexion (pour
//  voir l'orga) mais « Se connecter » entre SANS identifiants, et un 401 ramène sur
//  CETTE page V4 (plus vers le login V3). ON par défaut ; désactiver au build avec
//  NEXT_PUBLIC_AUTH_BYPASS=0 le jour où la vraie auth arrive.
const AUTH_BYPASS = process.env.NEXT_PUBLIC_AUTH_BYPASS !== '0';

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
  live_alerts: false,
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
  // ✅ Ré-activés 13/07 avec style + TileMatrixSet vérifiés (GetCapabilities IGN).
  { key: 'forets', label: 'Forêts publiques' },
  { key: 'protected', label: 'Points secours forêt 🌲' }, // PRSF = pts rencontre secours forêt (DFCI)
  { key: 'hydro', label: 'Hydrographie' },
  { key: 'routes', label: 'Routes' },
  { key: 'rail', label: 'Voies ferrées' },
  { key: 'admin', label: 'Limites admin' },
  { key: 'noms', label: 'Toponymes' },
  { key: 'pentes', label: 'Pentes' },
  { key: 'irc', label: 'Infrarouge' },
];
// Couches temps réel (checkboxes) — clé = clé activeLayers, title = infobulle FR.
const LIVE_OPTS: { key: string; label: string; title: string }[] = [
  { key: 'live_aircraft', label: 'Avions ✈ (adsb.lol)', title: 'Avions en vol — ADS-B public (adsb.lol), actualisé 15 s' },
  { key: 'live_earthquakes', label: 'Séismes (USGS)', title: 'Séismes des dernières 24 h — USGS public, actualisé 120 s' },
  { key: 'live_wildfires', label: 'Feux (FIRMS)', title: 'Foyers actifs — NASA FIRMS (nécessite une clé FIRMS_MAP_KEY)' },
  { key: 'live_volcanoes', label: 'Volcans', title: 'Volcans — à brancher (Smithsonian GVP)' },
  { key: 'live_satellites', label: 'Satellites 🛰', title: 'Satellites notables (celestrak + calcul SGP4, public sans clé)' },
  { key: 'live_ships', label: 'Navires 🚢', title: 'Navires AIS — nécessite une source/clé AIS (AIS_REST_URL)' },
  { key: 'live_gdelt', label: 'Géopolitique 🌍', title: 'Conflits mondiaux — ACLED (clé, build ARPD) ou actu conflits open-source (build général)' },
  { key: 'live_cyber', label: 'Cyber (C2) 🛡️', title: 'Serveurs C2 malware — abuse.ch public, sans clé (veille défensive)' },
  { key: 'live_alerts', label: 'Alertes disparitions 🟡', title: 'Avis de recherche officiels (Interpol Yellow, 116000) — repérés sur la carte' },
];
// ── Voyants de connexion (demande Cissou) : chaque couche live → source(s)
//  amont dans la télémétrie du diag. 🟢 connecté/ops · 🔴 pas connecté · 🟠 en
//  cours/incertain. Volcans/Navires/Alertes n'ont pas de source télémétrée ici. ──
const CONN_SOURCES: Record<string, string[]> = {
  live_aircraft: ['adsb.lol', 'opensky'],
  live_earthquakes: ['USGS'],
  live_wildfires: ['FIRMS'],
  live_satellites: ['celestrak'],
  live_gdelt: ['acled', 'geo-news', 'gdelt-export'],
  live_cyber: ['abuse.ch'],
};
type ConnState = 'ok' | 'fail' | 'wait';

/** Petit voyant animé : vert/orange « moulinent » (vivant), rouge statique. */
function ConnLED({ status }: { status?: ConnState }) {
  if (!status) return null;
  const color = status === 'ok' ? '#7cffb2' : status === 'fail' ? '#ff5a5a' : '#ffb23e';
  const label = status === 'ok' ? 'connecté (ops)' : status === 'fail' ? 'pas connecté' : 'en cours…';
  return (
    <span
      title={label}
      aria-label={label}
      className={'ml-auto ' + (status === 'fail' ? '' : 'animate-pulse')}
      style={{ width: 8, height: 8, borderRadius: 99, background: color, boxShadow: `0 0 6px ${color}`, display: 'inline-block', flexShrink: 0 }}
    />
  );
}

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
    // Émancipation 13/07 : le cockpit est OUVERT d'emblée. La page « voir l'orga /
    //  accès restreint » est désormais la route dédiée `/login` (V4), plus un
    //  LoginGate intercalé ici — Cissou ne doit JAMAIS retomber sur un écran d'identifiants
    //  en cliquant « Cockpit ». En standby (AUTH_BYPASS on) comme sous /cockpit (cookie),
    //  on entre direct ; un 401 renverra vers /login V4 (cf. runSearch, gated !AUTH_BYPASS).
    //  Le LoginGate reste importé mais dormant : réactivé le jour de la vraie auth (Lot C).
    if (COCKPIT_MODE || AUTH_BYPASS) { setAuthed(true); return; }
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

  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; ts: number; zoom?: number } | null>(null);
  const [spotlight, setSpotlight] = useState<SpotlightRegion>(null); // masque projecteur France/Europe
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
  // Handle CAPTURÉ (bug corrigé 07/07) : il était jeté → setBBox jamais appelé
  // → les couches denses (avions) restaient figées sur la bbox défaut France,
  // où que soit la carte. La carte pousse maintenant son emprise (onBoundsChange).
  const live = useDataPolling({ enabled: anyLiveOn });
  const handleBoundsChange = useCallback(
    (bbox: [number, number, number, number]) => live.setBBox(bbox),
    [live],
  );
  const aircraft = useDataKey<AircraftPoint[]>('aircraft');
  const earthquakes = useDataKey<QuakePoint[]>('earthquakes');
  const wildfires = useDataKey<FirePoint[]>('wildfires');
  const volcanoes = useDataKey<VolcanoPoint[]>('volcanoes');
  const satellites = useDataKey<SatellitePoint[]>('satellites');
  const ships = useDataKey<ShipPoint[]>('ships');
  const gdelt = useDataKey<GeoEventPoint[]>('gdelt');
  const cyber = useDataKey<CyberPoint[]>('cyber');

  // ── Couche « Alertes disparitions » (module V4.049) — endpoint dédié
  //  /cockpit/alerts (PAS live-feed). Poll léger (90 s) uniquement si allumée. ──
  const [missingAlerts, setMissingAlerts] = useState<AlertPoint[]>([]);
  const [alertsHealth, setAlertsHealth] = useState<AlertsHealth | null>(null);
  // Filtres chips (§12) : vide = tout affiché.
  const [alertCatFilter, setAlertCatFilter] = useState<string[]>([]);
  const [alertSrcFilter, setAlertSrcFilter] = useState<string[]>([]);
  const toggleAlertCat = useCallback((c: string) => setAlertCatFilter((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c])), []);
  const toggleAlertSrc = useCallback((s: string) => setAlertSrcFilter((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s])), []);
  // Chargement des avis + santé (réutilisable : poll auto ET bouton 🔄 manuel).
  const loadAlerts = useCallback(async () => {
    try {
      const [ra, rh] = await Promise.all([
        fetch(`${BASE_PATH}/alerts?statut=active`, { cache: 'no-store', credentials: 'include' }),
        fetch(`${BASE_PATH}/alerts/health`, { cache: 'no-store', credentials: 'include' }),
      ]);
      if (ra.ok) { const j = (await ra.json()) as { alerts?: AlertPoint[] }; setMissingAlerts(Array.isArray(j.alerts) ? j.alerts : []); }
      if (rh.ok) { const h = (await rh.json()) as AlertsHealth; setAlertsHealth(h); }
    } catch { /* couche vide, jamais de crash */ }
  }, []);
  useEffect(() => {
    if (!activeLayers.live_alerts) { setMissingAlerts([]); setAlertsHealth(null); return; }
    void loadAlerts();
    // Kick de rattrapage (fix « il faut cliquer 🔄 deux fois ») : au tout premier
    // affichage la carte n'est pas encore prête quand la 1ʳᵉ réponse arrive → un
    // 2ᵉ chargement peu après garantit que les marqueurs apparaissent seuls.
    const kick = setTimeout(() => void loadAlerts(), 1600);
    const id = setInterval(() => void loadAlerts(), 90_000);
    return () => { clearTimeout(kick); clearInterval(id); };
  }, [activeLayers.live_alerts, loadAlerts]);
  // ── Voyants de connexion : poll léger du diag (20 s) → statut par couche. ──
  const [connStatus, setConnStatus] = useState<Record<string, ConnState>>({});
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`${BASE_PATH}/live-feed/diag`, { cache: 'no-store', credentials: 'include' });
        if (!r.ok) return;
        const j = (await r.json()) as { telemetry?: { sources?: Record<string, { ok?: number; lastStatus?: number; lastNote?: string; lastCount?: number }> } };
        const src = j.telemetry?.sources || {};
        const statusOf = (names: string[]): ConnState => {
          const items = names.map((n) => src[n]).filter(Boolean) as { ok?: number; lastStatus?: number; lastNote?: string; lastCount?: number }[];
          if (!items.length) return 'wait';
          const failed = (s: { ok?: number; lastNote?: string }) => (s.ok || 0) === 0 || /fail|abort|timeout/i.test(s.lastNote || '');
          // 🟢 connecté ET des données ; 🟠 connecté mais 0 donnée (lastCount===0) ;
          // 🔴 aucune source ne répond. (Honnête : « 200 mais vide » ≠ ops.)
          if (items.some((s) => s.lastStatus === 200 && (s.ok || 0) > 0 && s.lastCount !== 0 && !/fail|abort|timeout/i.test(s.lastNote || ''))) return 'ok';
          if (items.some((s) => s.lastStatus === 200 && !/fail|abort|timeout/i.test(s.lastNote || ''))) return 'wait';
          if (items.every(failed)) return 'fail';
          return 'wait';
        };
        const next: Record<string, ConnState> = {};
        for (const [layer, names] of Object.entries(CONN_SOURCES)) next[layer] = statusOf(names);
        if (!stop) setConnStatus(next);
      } catch {
        /* voyants inconnus, jamais de crash */
      }
    };
    void load();
    const id = setInterval(() => void load(), 20_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  // Placement manuel d'un avis (ville/CP/dépt) → géocodé serveur, posé sur la
  // carte, puis on recharge. Renvoie l'erreur éventuelle pour l'UI.
  const placeAlert = useCallback(async (id: string, locality: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const r = await fetch(`${BASE_PATH}/alerts/place`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, locality }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (r.ok && j.ok) { await loadAlerts(); return { ok: true }; }
      return { ok: false, error: j.error || `erreur ${r.status}` };
    } catch {
      return { ok: false, error: 'réseau' };
    }
  }, [loadAlerts]);
  // Avis filtrés par catégorie + source (vide = tout) → passés à la carte.
  const filteredAlerts = useMemo(() => missingAlerts.filter((a) =>
    (alertCatFilter.length === 0 || alertCatFilter.includes(a.categorie || 'disparition')) &&
    (alertSrcFilter.length === 0 || alertSrcFilter.includes(a.source)),
  ), [missingAlerts, alertCatFilter, alertSrcFilter]);

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
    setSelectedEntity({ ...a, photo: null, route: null, socials: [] } as AircraftEnriched);
    enrichAircraft(a).then(setSelectedEntity).catch(() => {});
  }, []);

  // ── Lecteur de flux in-app (clic webcam/CCTV) ──
  const [activeStream, setActiveStream] = useState<StreamSource | null>(null);

  // ── Modes visuels (CRT / NVG / thermique) ──
  const [visualMode, setVisualMode] = useState<VisualMode>('normal');

  // ── Panneaux outils (rail droit) — UN SEUL ouvert à la fois (dispo « zones
  //  fixes », demande Cissou 09/07) : ouvrir l'un ferme les autres → plus
  //  d'empilement. `openTool(null)` ferme tout. ──
  const [osintOpen, setOsintOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const openTool = useCallback((tool: 'osint' | 'graph' | 'news' | null) => {
    setOsintOpen(tool === 'osint');
    setGraphOpen(tool === 'graph');
    setNewsOpen(tool === 'news');
  }, []);
  // Un panneau du RAIL DROIT (News/OSINT) est ouvert → la barre Alertes se
  // réserve la place (le Graphe est plein écran, il couvre → non concerné ici).
  const railOpen = osintOpen || newsOpen;

  // ── Deep-link « ?panel=… » depuis la sidebar de l'accueil ──────────────────
  // Les boutons Outils vivent sur l'accueil (leur vraie place, pas sur la
  // carte) ; ils ouvrent le cockpit directement sur le bon panneau, plein
  // écran. Ex. /cockpit?panel=osint → panneau OSINT ouvert au montage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const panel = new URLSearchParams(window.location.search).get('panel');
    if (!panel) return;
    if (panel === 'osint') openTool('osint');
    else if (panel === 'graph') openTool('graph');
    else if (panel === 'news') openTool('news');
    // Clés API = page dédiée depuis le 07/07 (les anciens liens ?panel=keys
    // continuent de fonctionner : on redirige).
    else if (panel === 'keys') window.location.replace(`${BASE_PATH}/cles-api`);
    // openTool est stable (useCallback []) → exécution unique au montage voulue.
  }, [openTool]);

  // ── Filtres d'attributs (filtrer DANS une couche affichée) ──
  const [filters, setFilters] = useState<LayerFilters>(DEFAULT_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // ── Retour visuel « lien copié » (bouton Partager de la ComfortBar) ──
  const [shareToast, setShareToast] = useState(false);

  // ── Sidebar repliable (comme l'accueil : « pour replier, ☰ pour rouvrir) ──
  const [navOpen, setNavOpen] = useState(true);

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
    setFlyToLocation({ lat: p.lat, lng: p.lng, ts: Date.now(), zoom: p.zoom });
    // Masque « projecteur » (demande Cissou) : France/Europe assombrissent le
    // reste du monde ; Monde et toute autre vue → pas de masque.
    setSpotlight(p.id === 'france' ? 'france' : p.id === 'europe' ? 'europe' : null);
  }, []);

  // ── Raccourcis clavier (c/r/o/t/v/p/Échap) — cf. lib/shortcuts.ts. Objet
  // mémoïsé pour éviter de ré-attacher l'écouteur à chaque rendu. ──
  const shortcutHandlers = useMemo(() => ({
    onToggleLayers: () => setLayersOpen((v) => !v),
    onRecenterFR: () => setFlyToLocation({ lat: 46.6, lng: 2.35, ts: Date.now() }),
    onOpenOsint: () => openTool('osint'),
    onOpenFilters: () => setFilterOpen((v) => !v),
    onCycleVisual: () => setVisualMode((m) => nextMode(m)),
    onShare: () => { void handleShare(); },
    onEscape: () => {
      setLayersOpen(false); setFilterOpen(false); setKeysOpen(false); openTool(null);
    },
  }), [handleShare, openTool]);
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
        // ⚠️ En bypass dev, on NE renvoie PAS vers le login V3 : on retombe sur le
        //  LoginGate V4 (1 clic pour re-rentrer), jamais la page mot de passe V3.
        if (COCKPIT_MODE && !AUTH_BYPASS) {
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
  // Largeur occupée par la sidebar flottante (0 si mobile ou repliée) → sert à
  // décaler le rail des couches + les contrôles carte pour qu'ils ne passent
  // JAMAIS sous la sidebar. navW+92/navW+120 reproduisent l'ancien layout.
  const navW = !isMobile && navOpen ? 232 : 0;
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

  // Scope RÉGIONAL (demande Cissou) : en vue France/Europe, on ne garde QUE les
  // points DANS la région (forme réelle de la France) pour les couches d'ambiance
  // → « que la France » + gain de puissance. Les ALERTES ne sont JAMAIS filtrées
  // (toujours mondiales). null (Monde) → tout passe (early-return, coût nul).
  const inReg = <T extends { lat?: number; lng?: number; lon?: number }>(arr: T[] | undefined): T[] => {
    const a = Array.isArray(arr) ? arr : [];
    if (!spotlight) return a;
    return a.filter((p) => isInRegion((typeof p.lng === 'number' ? p.lng : p.lon) as number, p.lat as number, spotlight));
  };

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
          aircraft={inReg(fAircraft)}
          earthquakes={inReg(fEarthquakes)}
          wildfires={inReg(wildfires)}
          volcanoes={inReg(volcanoes)}
          satellites={inReg(satellites)}
          ships={inReg(fShips)}
          gdelt={inReg(fGdelt)}
          cyber={inReg(fCyber)}
          alerts={filteredAlerts}
          sensitive={sensitive}
          onAircraftClick={handleAircraftClick}
          selectedAircraftHex={selectedEntity?.hex ?? null}
          onStreamClick={setActiveStream}
          projection={mapProjection}
          mapStyle={mapStyle}
          timeLayer={timeLayer}
          orthoYear={orthoYear}
          overlays={overlays}
          onMouseCoords={handleMouseCoords}
          onRightClick={handleRightClick}
          onBoundsChange={handleBoundsChange}
          flyToLocation={flyToLocation}
          spotlight={spotlight}
        />
      </ErrorBoundary>

      {/* ── BOUTON RETOUR ACCUEIL (desktop) — ARCHIVÉ le 07/07 à la demande de
          Cissou : doublon du lien « Accueil » de la sidebar + chevauchait la
          barre. On garde le code au cas où (réactiver = décommenter).
      {!isMobile && (
        <a
          href={lastQuery ? `/?q=${encodeURIComponent(lastQuery)}` : '/'}
          style={{ left: navW + 92 }}
          className="absolute top-4 z-[210] glass-panel hover-lift pointer-events-auto rounded-[12px] px-3 py-1.5 text-[10px] font-mono tracking-widest text-[var(--accent-bright)] hover:text-[var(--accent)] transition-colors"
          title="Retour à l'accueil"
        >
          ← Accueil
        </a>
      )}
      ── */}

      {/* ── PANNEAU COUCHES (desktop) ── */}
      {!isMobile && (
        <ErrorBoundary name="Couches">
          <LayerPanel data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} leftOffset={navW} />
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
          leftOffset={navW}
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

      {/* ── MODULE CLÉS API ── ⏸️ panneau ARCHIVÉ le 07/07 (page dédiée
          /cles-api à la place — demande Cissou). keysOpen ne peut plus passer
          à true (sidebar + deep-link pointent sur la page) ; on garde le
          montage pour une réactivation en 1 ligne. */}
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
          {/* Bouton retour accueil — TOUJOURS visible. La racine `/` du host V4 sert
              la landing (accueil V4, rewrite next.config). Anchor natif (pas next/link)
              → href '/' vise bien la racine du domaine courant. */}
          <a
            /* Accueil = RACINE `/` du host V4 (landing servie via rewrite next.config,
               Émancipation 13/07). Si une recherche est en cours, on garde la continuité
               avec ?q= sur cette même racine (la landing lit le paramètre). */
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

      {/* ── LÉGENDE CATÉGORIES AVIONS (visible si la couche Avions est active) ── */}
      {/* Barre de contrôle Alertes disparitions (chips filtres + badge fraîcheur) */}
      {activeLayers?.live_alerts && (
        <AlertsControlBar
          alerts={missingAlerts}
          filtered={filteredAlerts}
          catFilter={alertCatFilter}
          srcFilter={alertSrcFilter}
          onToggleCat={toggleAlertCat}
          onToggleSrc={toggleAlertSrc}
          onRefresh={loadAlerts}
          onPlace={placeAlert}
          health={alertsHealth}
          isMobile={isMobile}
          leftOffset={navOpen ? navW : 0}
          rightInset={railOpen ? 432 : 0}
        />
      )}

      {!isMobile && activeLayers?.live_aircraft && (
        <div
          className="glass-panel absolute z-[200] pointer-events-none px-3 py-2.5"
          style={{ right: '16px', bottom: '120px' }}
        >
          <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] mb-1.5">
            Catégories avions
          </div>
          <div className="flex flex-col gap-1">
            {AIRCRAFT_CAT_ORDER.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-[2px]"
                  style={{ background: AIRCRAFT_CAT_COLORS[k] }}
                />
                <span className="text-[10px] font-mono text-[var(--muted)]">
                  {AIRCRAFT_CAT_LABELS[k]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── PANNEAU MENU DE COUCHES (dépliable, au-dessus du bouton COUCHES) ── */}
      {layersOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="glass-panel absolute z-[210] pointer-events-auto p-4 w-[248px] overflow-y-auto"
          style={{
            left: isMobile ? '12px' : `${navW + 120}px`,
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
                  {/* Alertes : voyant dérivé de la fraîcheur de synchro (health),
                      pas du diag live-feed (endpoint séparé). */}
                  <ConnLED status={o.key === 'live_alerts'
                    ? (alertsHealth?.last_sync_at
                        ? (Date.now() - alertsHealth.last_sync_at < 45 * 60_000 ? 'ok' : 'wait')
                        : (alertsHealth ? 'fail' : undefined))
                    : connStatus[o.key]} />
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
        style={{ left: isMobile ? '12px' : `${navW + 120}px` }}
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
          onClick={() => openTool(osintOpen ? null : 'osint')}
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
      {!isMobile && navOpen && (
        <CockpitSidebar
          version={OSIRIS_VERSION}
          onCollapse={() => setNavOpen(false)}
          onOpenOsint={() => openTool('osint')}
          onOpenGraph={() => openTool('graph')}
          onOpenNews={() => openTool('news')}
        />
      )}

      {/* ── BOUTON ROUVRIR (☰) — visible quand la sidebar est repliée (desktop),
          calque du .nav-reopen de l'accueil. ── */}
      {!isMobile && !navOpen && (
        <button
          onClick={() => setNavOpen(true)}
          className="absolute top-4 left-4 z-[220] glass-panel hover-lift pointer-events-auto rounded-[12px] w-11 h-11 grid place-items-center text-[16px] text-[var(--accent-bright)] hover:border-[var(--accent)]/40 transition-colors"
          title="Afficher le menu"
          aria-label="Afficher le menu"
        >
          ☰
        </button>
      )}

      {/* ── Capsule debug (invention #15, composant canonique du brain
          `capsules/debug-capsule/`) — UN bouton 🐞 bas-gauche : capture les
          erreurs client + 📋 rapport copiable pour les agents + onglet « App »
          qui rend le moniteur des sources (ex-V4.073) via renderAppDiag.
          ON par défaut (staging/pré-auth) ; passer NEXT_PUBLIC_DEBUG_CAPSULE=0
          pour l'éteindre. À gater par rôle admin quand l'auth V4 sera en place. ── */}
      <DebugCapsule
        appName="OSIRIS V4"
        version={OSIRIS_VERSION}
        enabled={process.env.NEXT_PUBLIC_DEBUG_CAPSULE !== '0'}
        position="bottom-left"
        getAppDiag={() => fetch(`${BASE_PATH}/live-feed/diag`, { cache: 'no-store', credentials: 'include' }).then((r) => r.json())}
        renderAppDiag={(d) => <OsirisDiagView diag={d} />}
      />
    </main>
  );
}
