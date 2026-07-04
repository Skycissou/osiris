// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 LEAN — client API vers le backend FastAPI FR (EXTERNE).
//  Ce repo ne contient AUCUNE route de données FR : tout part en appel
//  sortant vers `NEXT_PUBLIC_API_BASE`. Le backend gère un login à COOKIE,
//  donc toutes les requêtes passent `credentials: 'include'`.
//  S'inspire du `fetchEndpoint` de l'ancien front (cache no-store).
// ─────────────────────────────────────────────────────────────────────────

/** Base URL du backend FastAPI FR (ex: https://api.osiris.cissouhub.cloud).
 *  DOIT rester VIDE ('') quand le cockpit est servi sous /cockpit du MÊME domaine
 *  que la V3 : les appels API partent alors à la RACINE de l'origine (`/search`,
 *  `/login`, …), là où Traefik route la V3 FastAPI (cookie partagé même-domaine). */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** basePath sous lequel CE front Next est servi (ex '/cockpit'). Vide en standalone.
 *  Source UNIQUE de vérité pour préfixer les routes internes Next (proxy-tiles…).
 *  ⚠️ NE concerne PAS les appels API (voir API_BASE) : ceux-ci restent à la racine. */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface ApiOptions extends RequestInit {
  /** Paramètres de query string ajoutés à l'URL. */
  params?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, params?: ApiOptions['params']): string {
  // API_BASE vide → chemin ABSOLU d'origine (ex '/search'). Le fetch natif résout
  // un chemin absolu contre l'ORIGINE du document, en IGNORANT le basePath Next :
  // c'est exactement voulu ici (cockpit sous /cockpit, mais API V3 à la racine).
  // On ne préfixe donc JAMAIS BASE_PATH ici.
  const base = API_BASE.replace(/\/$/, '');
  const url = /^https?:\/\//.test(path) ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  if (!params) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.append(k, String(v));
  }
  const q = qs.toString();
  return q ? `${url}${url.includes('?') ? '&' : '?'}${q}` : url;
}

/**
 * Fetch centralisé vers le backend FR.
 * - `credentials: 'include'` TOUJOURS (login à cookie).
 * - `cache: 'no-store'` par défaut (données temps réel), surchargeable.
 * - Lève sur statut non-OK pour que l'appelant gère l'erreur.
 */
export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { params, headers, ...rest } = options;
  const res = await fetch(buildUrl(path, params), {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...headers },
    ...rest,
  });
  if (!res.ok) {
    throw new Error(`[OSIRIS API] ${res.status} ${res.statusText} — ${path}`);
  }
  const ct = res.headers.get('content-type') || '';
  return (ct.includes('application/json') ? await res.json() : (await res.text())) as T;
}

/** Raccourci GET JSON — renvoie `null` en cas d'échec (fetch silencieux). */
export async function apiGet<T = unknown>(path: string, params?: ApiOptions['params']): Promise<T | null> {
  try {
    return await apiFetch<T>(path, { method: 'GET', params });
  } catch (e) {
    console.warn('[OSIRIS] apiGet failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Ping du backend (à câbler sur l'endpoint /health du FastAPI FR). */
export async function apiHealth(): Promise<boolean> {
  const r = await apiGet<{ status?: string }>('/health');
  return !!r;
}

// ─────────────────────────────────────────────────────────────────────────
//  TYPES — miroir EXACT du schéma backend (open_radar/models.py + schema.py).
//  Une "carte" = dataclass RadarResult.to_dict(). Le /search renvoie
//  build_standard_response(...) + un champ `graph` ajouté par l'orchestrateur.
// ─────────────────────────────────────────────────────────────────────────

export type ResultStatus = 'found' | 'not_found' | 'error' | 'partial' | 'blocked';

/** Entité extraite d'une carte. Les coords vivent ici : {type:'coordinates', value:'lat,lon'}. */
export interface RadarEntity {
  type: string;
  value: string;
  label?: string;
}

/** Carte de résultat — 1:1 avec RadarResult (backend). */
export interface RadarCard {
  source_id: string;
  source_label: string;
  access_level: string;
  confidence: string;
  status: ResultStatus;
  title: string;
  subtitle: string;
  summary: string;
  entities: RadarEntity[];
  raw_ref: Record<string, string>;
  limits: string[];
  actions: string[];
  raw_preview: Record<string, unknown>;
  provenance: string;
}

export interface BodaccGroup {
  annonces: RadarCard[];
  alerte_procedure_collective: boolean;
  source: string;
}

export interface Pagination {
  total_results: number;
  page: number;
  per_page: number;
  shown: number;
}

/** Résultats groupés — cf. schema.group_results(). Associations (rna) et DVF (dvf)
 *  ne sont PAS dans une clé dédiée : on les récupère depuis `raw_cards`. */
export interface SearchResultsGroup {
  entreprise: RadarCard[];
  adresse_geocodee: RadarCard[];
  commune: RadarCard[];
  bodacc: BodaccGroup;
  datasets: RadarCard[];
  raw_cards: RadarCard[];
  pagination?: Pagination;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  [k: string]: unknown;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Record<string, number>;
}

export interface SourceConsulted {
  name: string;
  source_id: string;
  url: string;
  status: string;
  response_time_ms: number | null;
}

/** Réponse complète de /search, /person, /company, /investigate. */
export interface SearchResponse {
  query: string;
  query_type: string;
  timestamp: string;
  sources_consulted: SourceConsulted[];
  results: SearchResultsGroup;
  cannot_conclude: string[];
  graph?: Graph;
  investigation?: Record<string, unknown>;
}

/** Filtres de /search (tous optionnels). */
export interface SearchFilters {
  page?: number;
  naf?: string;
  departement?: string;
  code_postal?: string;
  effectif?: string;
  categorie?: string;
  etat?: string;
  rge?: boolean;
  ess?: boolean;
  qualiopi?: boolean;
  association?: boolean;
  bio?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
//  APPELS TYPÉS
// ─────────────────────────────────────────────────────────────────────────

/** GET /search?q=&page=&naf=... — recherche cible principale du cockpit. */
export async function search(q: string, filters: SearchFilters = {}): Promise<SearchResponse> {
  return apiFetch<SearchResponse>('/search', {
    method: 'GET',
    params: { q, ...filters },
  });
}

/** GET /person?nom=&prenoms= — recherche par personne (dirigeants diffusés). */
export async function personSearch(nom: string, prenoms = ''): Promise<SearchResponse> {
  return apiFetch<SearchResponse>('/person', { method: 'GET', params: { nom, prenoms } });
}

/** GET /investigate?q=|nom=|prenoms= — pivot OSINT en cascade (bornée). */
export async function investigate(args: { q?: string; nom?: string; prenoms?: string }): Promise<SearchResponse> {
  return apiFetch<SearchResponse>('/investigate', { method: 'GET', params: { ...args } });
}

/** GET /company/{siren} — fiche entreprise par SIREN. */
export async function company(siren: string): Promise<SearchResponse> {
  return apiFetch<SearchResponse>(`/company/${encodeURIComponent(siren)}`, { method: 'GET' });
}

/** POST /login — pose le COOKIE de session (httponly). credentials:'include' requis. */
export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    return await apiFetch<{ ok: boolean; error?: string }>('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Échec de connexion' };
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  PLOT — extraction des coordonnées + construction des données carte.
//  RÉALITÉ BACKEND : seules les cartes BAN (source_id 'adresse') portent une
//  entité {type:'coordinates', value:'lat,lon'}. L'extracteur est générique :
//  si une autre source ajoute des coords un jour, elle est plottée d'office.
// ─────────────────────────────────────────────────────────────────────────

export interface PlotPoint {
  lat: number;
  lng: number;
  card: RadarCard;
  /** Clé de couche fr_* (sert au toggle sidebar + à la couleur). */
  typeKey: string;
}

/** Mappe un source_id backend vers la clé de couche fr_* de la sidebar. */
export const SOURCE_TO_LAYER: Record<string, string> = {
  recherche_entreprises: 'fr_entreprises',
  bodacc: 'fr_bodacc',
  dvf: 'fr_dvf',
  adresse: 'fr_ban',
  rna: 'fr_rna',
};

/** Extrait [lat, lon] d'une carte via l'entité coordinates. null si absent/invalide. */
export function extractLatLon(card: RadarCard): [number, number] | null {
  const e = (card.entities || []).find((x) => x.type === 'coordinates' && x.value);
  if (!e) return null;
  const parts = e.value.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat, lon] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

/** Construit les points à plotter, groupés par clé de couche fr_*. */
export function buildMapData(resp: SearchResponse | null): Record<string, PlotPoint[]> {
  const out: Record<string, PlotPoint[]> = {
    fr_entreprises: [], fr_bodacc: [], fr_dvf: [], fr_ban: [], fr_rna: [],
  };
  const cards = resp?.results?.raw_cards ?? [];
  for (const card of cards) {
    if (card.status !== 'found') continue;
    const key = SOURCE_TO_LAYER[card.source_id];
    if (!key) continue;
    const ll = extractLatLon(card);
    if (!ll) continue;
    out[key].push({ lat: ll[0], lng: ll[1], card, typeKey: key });
  }
  return out;
}

export interface CardGroup {
  key: string;
  label: string;
  color: string;
  cards: RadarCard[];
}

/** Définit l'ordre + libellés du panneau résultats (aligné sur les couleurs LayerPanel). */
const GROUP_DEFS: { source: string; key: string; label: string; color: string }[] = [
  { source: 'recherche_entreprises', key: 'entreprise', label: 'Entreprises', color: '#D4AF37' },
  { source: 'rna', key: 'association', label: 'Associations (RNA)', color: '#66BB6A' },
  { source: 'bodacc', key: 'bodacc', label: 'BODACC', color: '#EC407A' },
  { source: 'dvf', key: 'dvf', label: 'Valeurs foncières (DVF)', color: '#26C6DA' },
  { source: 'adresse', key: 'ban', label: 'Adresses (BAN)', color: '#7E57C2' },
  { source: 'geo_communes', key: 'commune', label: 'Communes', color: '#448AFF' },
  { source: 'data_gouv', key: 'datasets', label: 'Jeux de données', color: '#9E9E9E' },
];

/** Regroupe les cartes trouvées par type d'affichage, pour le panneau résultats. */
export function groupCardsByType(resp: SearchResponse | null): CardGroup[] {
  const cards = resp?.results?.raw_cards ?? [];
  return GROUP_DEFS.map((g) => ({
    key: g.key,
    label: g.label,
    color: g.color,
    cards: cards.filter((c) => c.source_id === g.source && c.status === 'found'),
  })).filter((g) => g.cards.length > 0);
}
