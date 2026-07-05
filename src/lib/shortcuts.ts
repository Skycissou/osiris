'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  shortcuts.ts — Raccourcis clavier du cockpit · OSIRIS V4
//  Agent CONFORT UI
//
//  RÔLE
//  ────
//  Hook React `useKeyboardShortcuts` qui écoute le clavier au niveau document et
//  déclenche des actions du cockpit (ouvrir un panneau, recentrer, partager…).
//  Il ne connaît RIEN de l'état de l'app : il reçoit un objet de callbacks
//  (`ShortcutHandlers`) et se contente d'appeler le bon selon la touche.
//
//  MAPPING FR (choix des touches)
//  ──────────────────────────────
//  On évite tout conflit avec les raccourcis navigateur et entre nos propres
//  touches. Chaque touche est une lettre unique, en minuscule, sans modificateur
//  (pas de Ctrl/Cmd → pas de collision avec Enregistrer, Rechercher, etc.).
//
//    c      → Couches      (ouvre/ferme le menu des couches)
//    r      → Recentrer FR (retour sur la France entière)
//    o      → OSINT        (boîte à outils d'investigation)
//    t      → Tri/filtres  (panneau de filtres — « t » comme Tri, « f » évité
//                           car trop proche de la sémantique « France »)
//    v      → Visuel       (cycle des modes visuels : normal → CRT → NVG → …)
//    p      → Partage      (génère + copie le lien de partage)
//    Échap  → Fermer       (referme le panneau/menu ouvert)
//
//  GARDE-FOUS
//  ──────────
//  • Les touches sont IGNORÉES quand l'utilisateur écrit dans un champ (INPUT,
//    TEXTAREA, SELECT ou élément contentEditable) → on ne vole pas la frappe de
//    la barre de recherche. Seule « Échap » reste traitée même depuis un champ
//    (fermeture = réflexe universel).
//  • On ignore aussi toute frappe accompagnée d'un modificateur (Ctrl/Cmd/Alt)
//    pour ne jamais écraser un raccourci système/navigateur.
//  • Pas de preventDefault agressif : on n'appelle preventDefault que pour nos
//    lettres réellement gérées, et jamais pour des combinaisons à modificateur.
//
//  SSR : le hook n'attache l'écouteur que dans un useEffect (donc côté client
//  uniquement) et le retire au cleanup. Rien ne s'exécute au rendu serveur.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react';

/**
 * Callbacks branchés par la page. Tous OPTIONNELS : une touche dont le handler
 * est absent est simplement sans effet (pas d'erreur). La page ne câble donc
 * que ce qu'elle sait faire.
 */
export interface ShortcutHandlers {
  /** `c` — ouvrir/fermer le menu des couches. */
  onToggleLayers?: () => void;
  /** `r` — recentrer la carte sur la France. */
  onRecenterFR?: () => void;
  /** `o` — ouvrir la boîte à outils OSINT. */
  onOpenOsint?: () => void;
  /** `t` — ouvrir le panneau de tri / filtres. */
  onOpenFilters?: () => void;
  /** `v` — passer au mode visuel suivant (CRT / NVG / thermique…). */
  onCycleVisual?: () => void;
  /** `Échap` — fermer le panneau / menu ouvert. */
  onEscape?: () => void;
  /** `p` — construire et copier le lien de partage. */
  onShare?: () => void;
}

/**
 * Aide affichable (panneau « ? » de la ComfortBar). L'ordre suit l'ordre de
 * découverte naturel ; `key` est le libellé de touche montré à l'écran.
 */
export const SHORTCUTS_HELP: { key: string; label: string }[] = [
  { key: 'C', label: 'Couches (fonds, temps réel…)' },
  { key: 'R', label: 'Recentrer sur la France' },
  { key: 'O', label: 'Boîte à outils OSINT' },
  { key: 'T', label: 'Tri / filtres' },
  { key: 'V', label: 'Mode visuel suivant' },
  { key: 'P', label: 'Partager la vue (copie le lien)' },
  { key: 'Échap', label: 'Fermer le panneau ouvert' },
];

/**
 * true si la cible d'un événement clavier est une zone de saisie (champ texte,
 * liste déroulante ou contenu éditable). Dans ce cas on n'intercepte pas les
 * lettres — l'utilisateur est en train d'écrire.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * useKeyboardShortcuts — attache un écouteur `keydown` global tant que le hook
 * est monté ET que `enabled` vaut true. Le handler est ré-attaché quand
 * `handlers` ou `enabled` changent (les callbacks passés doivent idéalement
 * être mémoïsés côté page pour éviter des ré-attachements inutiles).
 *
 * @param handlers  callbacks à déclencher par touche (tous optionnels).
 * @param enabled   interrupteur global (défaut true) — permet de couper les
 *                   raccourcis, p.ex. pendant une modale bloquante.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Jamais toucher aux combinaisons à modificateur (raccourcis système).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // « Échap » : traité même depuis un champ de saisie (réflexe universel).
      if (e.key === 'Escape') {
        if (handlers.onEscape) {
          handlers.onEscape();
        }
        return;
      }

      // Toute autre touche est ignorée si l'utilisateur écrit dans un champ.
      if (isTypingTarget(e.target)) return;

      // Normalisation : on compare en minuscule pour être insensible à Maj.
      const key = e.key.toLowerCase();

      // Table de correspondance touche → handler. On ne gère (et ne bloque le
      // comportement par défaut) QUE si un handler est effectivement branché.
      let handled: (() => void) | undefined;
      switch (key) {
        case 'c':
          handled = handlers.onToggleLayers;
          break;
        case 'r':
          handled = handlers.onRecenterFR;
          break;
        case 'o':
          handled = handlers.onOpenOsint;
          break;
        case 't':
          handled = handlers.onOpenFilters;
          break;
        case 'v':
          handled = handlers.onCycleVisual;
          break;
        case 'p':
          handled = handlers.onShare;
          break;
        default:
          handled = undefined;
      }

      if (handled) {
        // preventDefault ciblé : seulement pour nos lettres réellement gérées.
        e.preventDefault();
        handled();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
