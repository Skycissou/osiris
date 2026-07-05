'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  ComfortBar.tsx — Groupe de contrôles « confort » du cockpit · OSIRIS V4
//  Agent CONFORT UI
//
//  RÔLE
//  ────
//  Petit groupe de boutons, dans le même langage visuel que les CONTRÔLES CARTE
//  de la page (glass-panel + hover-lift + typo mono), regroupant trois conforts :
//    • « Vues »     → mini-menu listant les presets figés (VIEW_PRESETS) et les
//                     presets custom persistés → appelle onSelectPreset(p).
//    • « Partager » → déclenche onShare (la page construit + copie le lien).
//    • « ? »        → mini-panneau d'aide listant les raccourcis clavier
//                     (SHORTCUTS_HELP).
//
//  Le composant est AUTONOME sur son affichage (ouverture des mini-menus), mais
//  ne connaît RIEN de l'état carte : il remonte les intentions via ses props.
//  Les presets custom sont relus à chaque ouverture du menu « Vues » (source de
//  vérité = localStorage via viewPresets.ts).
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Eye, Share2, HelpCircle, X } from 'lucide-react';
import { VIEW_PRESETS, getCustomPresets, type ViewPreset } from '@/lib/viewPresets';
import { SHORTCUTS_HELP } from '@/lib/shortcuts';

interface ComfortBarProps {
  /** Appelé quand l'enquêteur choisit une destination de vue. */
  onSelectPreset: (p: ViewPreset) => void;
  /** Appelé au clic sur « Partager » (la page fabrique + copie le lien). */
  onShare: () => void;
  /** Rend la barre compacte sur mobile (placement/positions gérés par la page). */
  isMobile?: boolean;
}

// Classe commune des boutons — calque EXACT des pills de CONTRÔLES CARTE.
const PILL_CLASS =
  'glass-panel hover-lift rounded-[12px] px-3.5 py-2 pointer-events-auto ' +
  'hover:border-[var(--accent)]/40 transition-colors flex items-center gap-2 ' +
  'text-[9px] font-mono tracking-widest text-[var(--accent-bright)]';

export default function ComfortBar({ onSelectPreset, onShare, isMobile = false }: ComfortBarProps) {
  // Un seul mini-panneau ouvert à la fois : 'views' | 'help' | null.
  const [openMenu, setOpenMenu] = useState<'views' | 'help' | null>(null);
  // Presets custom relus à chaque ouverture du menu « Vues » (localStorage).
  const [customPresets, setCustomPresets] = useState<ViewPreset[]>([]);

  const toggleMenu = useCallback((menu: 'views' | 'help') => {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }, []);

  // À l'ouverture du menu « Vues », recharger les presets custom persistés.
  useEffect(() => {
    if (openMenu === 'views') setCustomPresets(getCustomPresets());
  }, [openMenu]);

  const handlePick = useCallback((p: ViewPreset) => {
    onSelectPreset(p);
    setOpenMenu(null);
  }, [onSelectPreset]);

  const handleShare = useCallback(() => {
    setOpenMenu(null);
    onShare();
  }, [onShare]);

  return (
    <div className="flex items-center gap-2 pointer-events-none">
      {/* ── BOUTON « VUES » (+ mini-menu presets) ── */}
      <div className="relative pointer-events-auto">
        <button
          onClick={() => toggleMenu('views')}
          className={`${PILL_CLASS} ${openMenu === 'views' ? 'text-[var(--accent)] border-[var(--accent)]/50 bg-[var(--accent-soft)]' : ''}`}
          title="Sauter vers une vue prédéfinie"
        >
          <Eye className="w-4 h-4" />
          {!isMobile && 'VUES'}
        </button>

        {openMenu === 'views' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="glass-panel absolute z-[220] pointer-events-auto p-3 w-[224px] bottom-full mb-2 left-0 overflow-y-auto"
            style={{ maxHeight: 'min(52vh, 420px)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono font-bold tracking-widest text-[var(--accent)]">VUES</span>
              <button
                onClick={() => setOpenMenu(null)}
                className="text-[var(--faint)] hover:text-[var(--accent)] transition-colors"
                title="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Presets figés (livrés avec l'app) */}
            <div className="flex flex-col gap-1">
              {VIEW_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handlePick(p)}
                  className="osiris-row flex items-center gap-2.5 px-2 py-1.5 text-left"
                  title={`Aller à : ${p.label}`}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-white/30" />
                  <span className="text-[11px] font-mono text-white/70">{p.label}</span>
                </button>
              ))}
            </div>

            {/* Presets custom (persistés en localStorage) */}
            {customPresets.length > 0 && (
              <div className="mt-3">
                <div className="text-[9px] font-mono tracking-widest text-[var(--accent-bright)] uppercase mb-2 pb-1 border-b border-white/10">
                  Mes vues
                </div>
                <div className="flex flex-col gap-1">
                  {customPresets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handlePick(p)}
                      className="osiris-row flex items-center gap-2.5 px-2 py-1.5 text-left"
                      title={`Aller à : ${p.label}`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-[var(--accent)]/50" />
                      <span className="text-[11px] font-mono text-white/70">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* ── BOUTON « PARTAGER » ── */}
      <button
        onClick={handleShare}
        className={`${PILL_CLASS} pointer-events-auto`}
        title="Copier un lien vers cette vue"
      >
        <Share2 className="w-4 h-4" />
        {!isMobile && 'PARTAGER'}
      </button>

      {/* ── BOUTON « ? » (aide raccourcis) + mini-panneau ── */}
      <div className="relative pointer-events-auto">
        <button
          onClick={() => toggleMenu('help')}
          className={`${PILL_CLASS} ${openMenu === 'help' ? 'text-[var(--accent)] border-[var(--accent)]/50 bg-[var(--accent-soft)]' : ''}`}
          title="Aide : raccourcis clavier"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        {openMenu === 'help' && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="glass-panel absolute z-[220] pointer-events-auto p-3 w-[248px] bottom-full mb-2 right-0 overflow-y-auto"
            style={{ maxHeight: 'min(52vh, 420px)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-mono font-bold tracking-widest text-[var(--accent)]">RACCOURCIS</span>
              <button
                onClick={() => setOpenMenu(null)}
                className="text-[var(--faint)] hover:text-[var(--accent)] transition-colors"
                title="Fermer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              {SHORTCUTS_HELP.map((s) => (
                <div key={s.key} className="flex items-center gap-3">
                  <kbd className="flex-shrink-0 min-w-[34px] text-center px-1.5 py-0.5 rounded-[6px] border border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[10px] font-mono tracking-widest text-[var(--accent)]">
                    {s.key}
                  </kbd>
                  <span className="text-[11px] font-mono text-white/70">{s.label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
