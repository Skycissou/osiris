// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — visualModes.ts : catalogue des « modes visuels » (skins) du
//  cockpit.
//  ---------------------------------------------------------------------------
//  RÔLE
//    Décrire — comme des DONNÉES, pas comme du code — les habillages visuels
//    plein écran que l'opérateur peut appliquer par-dessus la carte :
//    normal, CRT, vision nocturne (NVG), thermique. Ce fichier ne rend RIEN :
//    il fournit le type, la liste (label + description en français) et un
//    petit helper de cyclage. Le rendu vit dans <VisualModeOverlay />.
//
//  CLEAN-ROOM & CHARTE
//    L'idée de proposer des « skins » FLIR/NVG/CRT est inspirée du *concept*
//    ShadowBroker, mais tout ici est ré-écrit from scratch et surtout TEINTÉ
//    charte OSIRIS (accent #54bdde) — PAS le vert « matrix » cru. Aucune ligne
//    n'a été copiée d'un autre projet. Livré sous licence MIT (repo OSIRIS).
//
//  POURQUOI DES OVERLAYS CSS (et pas des shaders)
//    Un simple calque CSS plein écran (position:fixed, pointer-events:none)
//    est : léger, sans WebGL, sans dépendance, désactivable instantanément,
//    et n'altère JAMAIS les données ni la logique de la carte. Dégradation
//    douce garantie : au pire, on n'affiche rien.
// ─────────────────────────────────────────────────────────────────────────

/**
 * VisualMode — identifiant canonique d'un habillage visuel.
 *   'normal'  : aucun effet (état par défaut).
 *   'crt'     : écran cathodique — scanlines + vignette + léger flicker.
 *   'nvg'     : vision nocturne — voile vert-cyan doux + vignette.
 *   'thermal' : imagerie thermique — dégradé chaud/froid subtil (mix-blend).
 */
export type VisualMode = 'normal' | 'crt' | 'nvg' | 'thermal';

/**
 * VisualModeDef — description déclarative d'un mode (consommée par l'UI).
 *   id          : identifiant canonique (clé, matche l'overlay).
 *   label       : libellé court affiché (français).
 *   description : phrase courte expliquant l'effet (tooltip / a11y).
 *   icon        : nom d'icône lucide-react suggéré (résolu côté UI), optionnel.
 */
export interface VisualModeDef {
  id: VisualMode;
  label: string;
  description: string;
  icon?: string;
}

/**
 * VISUAL_MODES — catalogue ordonné des modes.
 *   L'ORDRE définit aussi la séquence de cyclage de nextMode() :
 *   normal → crt → nvg → thermal → (retour à) normal.
 */
export const VISUAL_MODES: readonly VisualModeDef[] = [
  {
    id: 'normal',
    label: 'Normal',
    description: 'Aucun effet — rendu carte standard.',
    icon: 'Monitor',
  },
  {
    id: 'crt',
    label: 'CRT',
    description: 'Écran cathodique : scanlines, vignette et léger flicker (teinte accent).',
    icon: 'Tv',
  },
  {
    id: 'nvg',
    label: 'Vision nocturne',
    description: 'Voile vert-cyan doux et vignette — ambiance NVG dans les tons OSIRIS.',
    icon: 'Moon',
  },
  {
    id: 'thermal',
    label: 'Thermique',
    description: 'Dégradé chaud/froid subtil en surimpression (imagerie thermique légère).',
    icon: 'Thermometer',
  },
] as const;

/**
 * getVisualMode — retrouve la définition d'un mode par son id.
 *   Renvoie undefined si l'id est inconnu (dégradation douce côté appelant).
 */
export function getVisualMode(id: VisualMode): VisualModeDef | undefined {
  return VISUAL_MODES.find((m) => m.id === id);
}

/**
 * nextMode — renvoie le mode SUIVANT dans l'ordre de VISUAL_MODES (cyclique).
 *   Utilisé par le bouton « cycler l'habillage » du cockpit :
 *     setVisualMode((m) => nextMode(m));
 *   Robuste : un mode inconnu (ne devrait pas arriver) repart de 'normal'.
 */
export function nextMode(current: VisualMode): VisualMode {
  const idx = VISUAL_MODES.findIndex((m) => m.id === current);
  if (idx === -1) return VISUAL_MODES[0].id; // repli défensif
  return VISUAL_MODES[(idx + 1) % VISUAL_MODES.length].id;
}
