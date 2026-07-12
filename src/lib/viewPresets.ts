// ─────────────────────────────────────────────────────────────────────────────
//  viewPresets.ts — Presets de VUE (destinations carte prédéfinies) · OSIRIS V4
//  Agent CONFORT UI
//
//  RÔLE
//  ────
//  Un « preset de vue » = une destination carte mémorisée (latitude, longitude,
//  zoom optionnel) portant un label FR lisible. Il permet à l'enquêteur de
//  sauter en un clic sur une zone récurrente (France entière, Occitanie, la
//  Méditerranée…) sans retaper des coordonnées. Le composant <ComfortBar>
//  affiche ces presets dans son menu « Vues ».
//
//  DEUX SOURCES DE PRESETS
//  ───────────────────────
//    1. VIEW_PRESETS  — catalogue FIGÉ livré avec l'app (constantes ci-dessous).
//    2. presets CUSTOM — ajoutés par l'enquêteur, PERSISTÉS dans localStorage
//       (clé `osiris-view-presets`). Ils survivent au rechargement mais restent
//       LOCAUX au navigateur (pas de compte, pas de synchro serveur).
//
//  CONTRAT SSR / ROBUSTESSE (Next)
//  ───────────────────────────────
//  localStorage n'existe pas côté serveur (rendu SSR) ni si l'accès est bloqué
//  (navigation privée stricte). Toutes les fonctions de stockage passent par la
//  garde `safeStorage()` — même pattern que `apiKeys.ts` — et ne throw JAMAIS :
//  en cas d'indisponibilité on retombe sur un comportement neutre (liste vide,
//  no-op). L'appelant n'a donc jamais à envelopper ces appels dans un try/catch.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

// ── Modèle d'un preset ────────────────────────────────────────────────────────
/**
 * Un preset de vue = une destination carte.
 *  - `id`    : identifiant unique et stable (slug). Sert de clé React et de clé
 *              de suppression pour les presets custom.
 *  - `label` : nom FR lisible affiché dans le menu « Vues ».
 *  - `lat`   : latitude du centre (degrés décimaux, WGS84).
 *  - `lng`   : longitude du centre (degrés décimaux, WGS84).
 *  - `zoom`  : niveau de zoom MapLibre souhaité (optionnel ; l'appelant applique
 *              une valeur de repli s'il est absent).
 */
export interface ViewPreset {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom?: number;
}

// ── Catalogue figé (livré avec l'app) ─────────────────────────────────────────
/**
 * Presets de base, ordonnés du plus général (Monde) aux zones françaises
 * fréquentes (contexte ARPD / Occitanie). Coordonnées réalistes (centres
 * géographiques usuels), zoom indicatif adapté à l'emprise de chaque zone.
 */
export const VIEW_PRESETS: readonly ViewPreset[] = [
  // ── 3 vues principales (demande Cissou) : France · Europe · Monde ──────────
  { id: 'france', label: '🇫🇷 France', lat: 46.6, lng: 2.35, zoom: 5.2 },
  { id: 'europe', label: '🇪🇺 Europe', lat: 50, lng: 10, zoom: 3.6 },
  { id: 'monde', label: '🌍 Monde', lat: 20, lng: 5, zoom: 1.6 },
  // ── Zones fréquentes (bonus ARPD / Occitanie) ─────────────────────────────
  { id: 'paris', label: 'Paris', lat: 48.8566, lng: 2.3522, zoom: 11 },
  { id: 'occitanie', label: 'Occitanie (Toulouse)', lat: 43.6045, lng: 1.444, zoom: 8 },
  { id: 'mediterranee', label: 'Méditerranée', lat: 42.5, lng: 4.5, zoom: 6 },
  { id: 'manche_atlantique', label: 'Manche / Atlantique', lat: 47.5, lng: -3.5, zoom: 6 },
] as const;

// ── Stockage des presets custom (SSR-safe, jamais de throw) ───────────────────
/** Clé localStorage unique où sont sérialisés les presets custom (tableau JSON). */
const STORAGE_KEY = 'osiris-view-presets';

/**
 * Garde SSR : localStorage est absent côté serveur (Next SSR) et peut être
 * refusé (mode privé strict / politique). On teste sa présence à chaque appel
 * — jamais de throw, on retombe sur un comportement neutre. Copie du pattern
 * `safeStorage()` d'apiKeys.ts pour rester homogène entre agents.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    // Accès localStorage refusé (navigation privée / politique) → neutre.
    return null;
  }
}

/**
 * Valide une valeur inconnue et la normalise en ViewPreset, ou renvoie null.
 * Sert de filtre défensif à la relecture du JSON (données potentiellement
 * corrompues ou d'une version antérieure du format).
 */
function toValidPreset(raw: unknown): ViewPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { id, label, lat, lng, zoom } = r;
  if (typeof id !== 'string' || !id) return null;
  if (typeof label !== 'string' || !label) return null;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return null;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return null;
  const preset: ViewPreset = { id, label, lat, lng };
  if (typeof zoom === 'number' && Number.isFinite(zoom)) preset.zoom = zoom;
  return preset;
}

/**
 * Lit les presets custom persistés. Renvoie [] si absent, si SSR, si JSON
 * illisible ou en cas d'erreur. Chaque entrée est re-validée (défensif).
 * Ne throw jamais.
 */
export function getCustomPresets(): ViewPreset[] {
  const store = safeStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(toValidPreset)
      .filter((p): p is ViewPreset => p !== null);
  } catch {
    // JSON corrompu / stockage indisponible → liste vide.
    return [];
  }
}

/**
 * Écrit (remplace) l'ensemble des presets custom. Interne : jamais exposé tel
 * quel pour garder un seul point de sérialisation. Renvoie true si tenté.
 */
function writeCustomPresets(presets: ViewPreset[]): boolean {
  const store = safeStorage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(presets));
    return true;
  } catch {
    // Quota plein / stockage indisponible → échec silencieux.
    return false;
  }
}

/**
 * Ajoute (ou remplace, à id égal) un preset custom. Un preset existant portant
 * le même `id` est écrasé — ce qui permet aussi de « mettre à jour » une vue.
 * Une valeur invalide (coords non finies, label/id vide) est ignorée sans
 * effet. Ne throw jamais.
 */
export function addCustomPreset(preset: ViewPreset): void {
  const valid = toValidPreset(preset);
  if (!valid) return;
  const current = getCustomPresets().filter((p) => p.id !== valid.id);
  current.push(valid);
  writeCustomPresets(current);
}

/**
 * Supprime le preset custom portant cet id. Sans effet si l'id est inconnu.
 * N'affecte JAMAIS le catalogue figé VIEW_PRESETS (uniquement le stockage
 * custom). Ne throw jamais.
 */
export function removeCustomPreset(id: string): void {
  if (!id) return;
  const current = getCustomPresets();
  const next = current.filter((p) => p.id !== id);
  if (next.length !== current.length) writeCustomPresets(next);
}
