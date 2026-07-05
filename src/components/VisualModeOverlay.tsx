'use client';

// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — VisualModeOverlay : calque plein écran des « modes visuels ».
//  ---------------------------------------------------------------------------
//  RÔLE
//    Rend l'habillage visuel choisi (voir src/lib/visualModes.ts) PAR-DESSUS
//    toute l'interface : CRT, vision nocturne (NVG) ou thermique. Purement
//    DÉCORATIF et NON-INTERACTIF (pointer-events: none) : ce calque ne capte
//    aucun clic, ne modifie aucune donnée, ne touche PAS à la carte.
//
//  ISOLATION (important)
//    • Tout le style vit dans un bloc <style jsx> SCOPÉ à ce composant :
//      on NE MODIFIE PAS globals.css, aucune fuite de style globale.
//    • Aucune dépendance nouvelle : uniquement react + framer-motion (déjà
//      présents dans le projet).
//
//  CHARTE OSIRIS (clean-room)
//    Concept de skins inspiré de ShadowBroker, mais RÉ-ÉCRIT et TEINTÉ charte
//    OSIRIS : accent #54bdde, bleu clair #9bdcf0, vert #5bc78d. Pas de vert
//    « matrix » cru. Effets volontairement SUBTILS (lisibilité avant tout).
//
//  TRANSITION
//    framer-motion (AnimatePresence + fondu d'opacité) assure un passage doux
//    d'un mode à l'autre. Le mode 'normal' ne rend rien (calque vide).
//
//  DÉGRADATION DOUCE
//    Un mode inconnu ⇒ rien rendu. `prefers-reduced-motion` ⇒ le flicker CRT
//    et le balayage de scanlines sont neutralisés (voir media-query).
//
//  ── Intégration dans page.tsx (cockpit) ───────────────────────────────────
//    'use client';
//    import { useState } from 'react';
//    import VisualModeOverlay from '@/components/VisualModeOverlay';
//    import { nextMode, getVisualMode, type VisualMode } from '@/lib/visualModes';
//
//    // 1. État du mode courant :
//    const [visualMode, setVisualMode] = useState<VisualMode>('normal');
//
//    // 2. Bouton de cyclage (à placer dans la barre d'outils du cockpit) :
//    <button
//      type="button"
//      title={getVisualMode(visualMode)?.description}
//      onClick={() => setVisualMode((m) => nextMode(m))}
//    >
//      Habillage : {getVisualMode(visualMode)?.label}
//    </button>
//
//    // 3. Monter l'overlay AU-DESSUS de la carte (dernier enfant du layout,
//    //    pour un z-index effectif ; il est déjà position:fixed) :
//    <VisualModeOverlay mode={visualMode} />
// ─────────────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { VisualMode } from '@/lib/visualModes';

// ── Charte OSIRIS (rappel local, pour lisibilité des effets ci-dessous) ──────
const ACCENT = '#54bdde'; // bleu principal
const BRIGHT = '#9bdcf0'; // bleu clair
const NVG = '#5bc78d'; // vert OSIRIS (base NVG teintée maison, PAS vert matrix)

// z-index élevé : au-dessus des panneaux/toasts, sous d'éventuelles modales
// bloquantes système. Ajustable si le cockpit introduit une couche plus haute.
const OVERLAY_Z = 8000;

export interface VisualModeOverlayProps {
  /** Mode visuel courant. 'normal' ⇒ aucun calque rendu. */
  mode: VisualMode;
}

/**
 * VisualModeOverlay — calque décoratif plein écran, non-interactif.
 * Memoïsé : ne se re-rend que si `mode` change.
 */
function VisualModeOverlayImpl({ mode }: VisualModeOverlayProps) {
  return (
    <div className="osiris-vmode-root" aria-hidden="true">
      <AnimatePresence mode="wait">
        {mode !== 'normal' && (
          <motion.div
            key={mode}
            className={`osiris-vmode osiris-vmode--${mode}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeInOut' }}
          >
            {/* CRT : couche scanlines animée séparée pour le balayage vertical */}
            {mode === 'crt' && <span className="osiris-vmode__scan" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Styles SCOPÉS au composant (styled-jsx) — aucune fuite globale. */}
      <style jsx>{`
        .osiris-vmode-root {
          position: fixed;
          inset: 0;
          pointer-events: none; /* jamais interactif */
          z-index: ${OVERLAY_Z};
        }

        .osiris-vmode {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        /* ── CRT ────────────────────────────────────────────────────────────
           Vignette + fines scanlines + très léger flicker. Teinte accent. */
        .osiris-vmode--crt {
          /* vignette douce + voile accent quasi imperceptible */
          background:
            radial-gradient(
              ellipse at center,
              transparent 55%,
              rgba(6, 12, 20, 0.55) 100%
            ),
            linear-gradient(
              rgba(84, 189, 222, 0.04),
              rgba(84, 189, 222, 0.04)
            );
          mix-blend-mode: normal;
          animation: osiris-crt-flicker 5.5s steps(60) infinite;
        }
        /* scanlines : lignes horizontales fines, balayées lentement */
        .osiris-vmode--crt .osiris-vmode__scan {
          position: absolute;
          inset: -2px 0;
          background: repeating-linear-gradient(
            to bottom,
            rgba(155, 220, 240, 0.06) 0px,
            rgba(155, 220, 240, 0.06) 1px,
            transparent 1px,
            transparent 3px
          );
          animation: osiris-crt-scan 8s linear infinite;
        }

        /* ── NVG (vision nocturne) ──────────────────────────────────────────
           Voile vert-cyan doux + vignette marquée. Tons OSIRIS. */
        .osiris-vmode--nvg {
          background:
            radial-gradient(
              ellipse at center,
              rgba(91, 199, 141, 0.1) 0%,
              rgba(91, 199, 141, 0.06) 45%,
              rgba(4, 14, 10, 0.6) 100%
            ),
            linear-gradient(
              rgba(91, 199, 141, 0.12),
              rgba(84, 189, 222, 0.08)
            );
          mix-blend-mode: screen;
        }

        /* ── THERMIQUE ──────────────────────────────────────────────────────
           Dégradé chaud (haut) → froid (bas) très léger, en surimpression. */
        .osiris-vmode--thermal {
          background: linear-gradient(
            160deg,
            rgba(214, 164, 69, 0.16) 0%,
            rgba(219, 111, 120, 0.12) 30%,
            rgba(154, 140, 239, 0.12) 65%,
            rgba(84, 189, 222, 0.16) 100%
          );
          mix-blend-mode: overlay;
        }

        @keyframes osiris-crt-flicker {
          0%,
          100% {
            opacity: 1;
          }
          48% {
            opacity: 1;
          }
          50% {
            opacity: 0.94;
          }
          52% {
            opacity: 1;
          }
        }

        @keyframes osiris-crt-scan {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(3px);
          }
        }

        /* Accessibilité : pas d'animation si l'utilisateur la refuse. */
        @media (prefers-reduced-motion: reduce) {
          .osiris-vmode--crt {
            animation: none;
          }
          .osiris-vmode--crt .osiris-vmode__scan {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

// Petites constantes exportées pour un éventuel réglage fin côté cockpit
// (documentées, non obligatoires à l'usage).
export const VISUAL_OVERLAY_Z_INDEX = OVERLAY_Z;
export const VISUAL_OVERLAY_TINTS = { ACCENT, BRIGHT, NVG } as const;

const VisualModeOverlay = memo(VisualModeOverlayImpl);
export default VisualModeOverlay;
