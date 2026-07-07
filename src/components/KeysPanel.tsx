'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  KeysPanel.tsx — Panneau flottant « Clés API » (OSIRIS V4 · cockpit)
//
//  ⏸️  ARCHIVÉ le 07/07 à la demande de Cissou : le module Clés API vit
//  désormais sur une PAGE DÉDIÉE → src/app/cles-api/page.tsx (/cockpit/cles-api).
//  Ce panneau n'est plus référencé par l'UI (sidebar + deep-link pointent sur la
//  page) mais reste fonctionnel — règle « enrichir, jamais effacer ».
//  Réactivation : remonter l'état keysOpen + le montage dans page.tsx.
//
//  Le CONTENU (cartes de services par catégorie) vit dans KeysManager.tsx,
//  source unique partagée avec la page dédiée — ce fichier n'est plus que le
//  chrome flottant (glass-panel + framer-motion + en-tête/pied).
// ─────────────────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { motion } from 'framer-motion';
import { X, KeyRound, ShieldCheck } from 'lucide-react';
import KeysManager from '@/components/KeysManager';

// ── Props ─────────────────────────────────────────────────────────────────────
interface KeysPanelProps {
  /** Ferme le panneau (branché sur setKeysOpen(false)). */
  onClose: () => void;
  /** Layout compact mobile (mêmes règles que les autres panneaux). */
  isMobile?: boolean;
}

// ── Panneau principal ─────────────────────────────────────────────────────────
function KeysPanel({ onClose, isMobile }: KeysPanelProps) {
  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3, calque OsintPanel).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[208] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        // Un peu plus large : contenu documenté (liens + procédures).
        width: isMobile ? 'auto' : '440px',
        maxHeight: isMobile ? '64vh' : 'calc(100vh - 240px)',
      }}
    >
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          <KeyRound className="w-3.5 h-3.5" />
          Clés API
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Bandeau explicatif ── */}
      <div className="px-3 py-2.5 border-b border-[var(--border-primary)]">
        <p className="text-[10px] font-mono text-[var(--muted)] leading-relaxed">
          Tes clés sont stockées <span className="text-[var(--accent)]">localement</span> dans ce
          navigateur et envoyées uniquement à nos routes serveur. Renseigne-les ici sans toucher au
          déploiement.
        </p>
      </div>

      {/* ── Corps : cartes de services (source unique KeysManager) ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3">
        <KeysManager />
      </div>

      {/* ── Pied : note de sécurité ── */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[var(--border-primary)]">
        <ShieldCheck className="w-3 h-3 flex-shrink-0 text-[var(--faint)]" />
        <p className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] leading-relaxed">
          Clés locales (ce navigateur) · usage perso enquêteur · jamais partagées à un tiers
        </p>
      </div>
    </motion.div>
  );
}

export default memo(KeysPanel);
