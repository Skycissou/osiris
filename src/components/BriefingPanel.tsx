'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  BriefingPanel.tsx — Panneau « Briefing de situation IA » (OSIRIS V4 · cockpit)
//  Agent IA ANALYSE / BRIEFING
//
//  RÔLE
//  ────
//  Génère, à la demande, un COURT briefing de situation FR à partir du CONTEXTE
//  CARTE courant (couches actives, décomptes, entités notables, zone), servi par
//  la route interne POST /analyze. La route dégrade en douceur : sans clé LLM
//  (ou LLM en échec) le briefing est « basique » (déterministe, ai:false) ; avec
//  clé et LLM OK il est « IA » (ai:true). Un badge le signale à l'enquêteur.
//
//  CHARTE V3 (calque d'OsintPanel / NewsPanel) : panneau glassmorphism
//  `glass-panel`, libellés techniques en `font-mono` `tracking-widest` accent
//  `--accent`, apparition douce depuis la droite (framer-motion), scrollbar
//  `styled-scrollbar`, bouton fermer (X lucide-react) identique, `text-[11px]`.
//
//  INTÉGRATION (dans src/app/page.tsx) — même schéma que les autres panneaux :
//    1) État d'ouverture :
//         const [briefingOpen, setBriefingOpen] = useState(false);
//    2) Bouton dans la barre d'outils (à côté du bouton News/OSINT) :
//         <button onClick={() => setBriefingOpen(true)} title="Briefing IA">IA</button>
//    3) Montage du panneau (sous <AnimatePresence>) — le CHEF fournit `getContext`,
//       une closure qui lit l'état carte courant (couches actives + décomptes) :
//         <AnimatePresence>
//           {briefingOpen && (
//             <BriefingPanel
//               getContext={() => ({ layers: activeLayers, counts, place, bbox })}
//               onClose={() => setBriefingOpen(false)}
//               isMobile={isMobile}
//             />
//           )}
//         </AnimatePresence>
//    Chargement paresseux possible comme les autres panneaux :
//       const BriefingPanel = dynamic(() => import('@/components/BriefingPanel'), { ssr: false });
//
//  CADRE DÉFENSIF ARPD : analyse de SITUATION sur données PUBLIQUES déjà agrégées
//  sur la carte. Aucun ciblage de personne, aucune donnée privée. Rappel en pied.
//
//  Ré-écriture clean-room (calque : src/components/NewsPanel.tsx) : aucune ligne
//  copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  BrainCircuit,
  Loader2,
  Sparkles,
  FileText,
  Copy,
  Check,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { requestBriefing, type BriefingContext, type BriefingResult } from '@/lib/analyzeClient';

// ── Props ─────────────────────────────────────────────────────────────────────
interface BriefingPanelProps {
  /** Closure fournie par le chef : lit l'état carte courant au moment du clic. */
  getContext: () => BriefingContext;
  /** Ferme le panneau (branché sur setBriefingOpen(false)). */
  onClose: () => void;
  /** Layout compact mobile (mêmes règles que les autres panneaux). */
  isMobile?: boolean;
}

// ── Panneau principal ─────────────────────────────────────────────────────────
function BriefingPanel({ getContext, onClose, isMobile }: BriefingPanelProps) {
  const [result, setResult] = useState<BriefingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // AbortController de la requête en cours : annulé si nouvelle génération / démontage.
  const abortRef = useRef<AbortController | null>(null);

  /**
   * generer — lit le contexte carte courant (closure du chef) et demande le
   * briefing à /analyze via requestBriefing (qui ne throw jamais). Toute erreur
   * inattendue devient un message FR affiché — jamais de crash.
   */
  const generer = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const ctx = getContext();
      const res = await requestBriefing(ctx, controller.signal);
      if (controller.signal.aborted) return;
      setResult(res);
    } catch {
      if (controller.signal.aborted) return;
      // requestBriefing ne throw pas, mais getContext() pourrait — filet ultime.
      setError('Impossible de lire le contexte de la carte.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [getContext]);

  // Annulation propre au démontage (évite les setState sur composant démonté).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Copie du briefing dans le presse-papier (dégradation douce si indisponible).
  const copier = useCallback(async () => {
    if (!result?.briefing) return;
    try {
      await navigator.clipboard.writeText(result.briefing);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Presse-papier refusé (contexte non sécurisé / permission) → on ignore.
    }
  }, [result]);

  const hasResult = !!result?.briefing;

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[210] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        width: isMobile ? 'auto' : '400px',
        maxHeight: isMobile ? '62vh' : 'calc(100vh - 240px)',
      }}
    >
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          <BrainCircuit className="w-3.5 h-3.5" />
          Briefing de situation
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Barre d'action : générer / régénérer + badge + copier ── */}
      <div className="px-3 py-2.5 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void generer()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
            title={hasResult ? 'Régénérer le briefing' : 'Générer le briefing'}
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            {hasResult ? 'Régénérer' : 'Générer le briefing'}
          </button>

          {/* Badge IA vs basique (visible dès qu'un résultat existe). */}
          {hasResult && result && (
            <span
              className={
                'flex items-center gap-1 rounded px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest border ' +
                (result.ai
                  ? 'text-[var(--accent-bright)] border-[var(--accent-line)] bg-[var(--accent-soft)]'
                  : 'text-[var(--faint)] border-[var(--border-primary)]')
              }
              title={
                result.ai
                  ? `Briefing rédigé par IA${result.provider ? ` (${result.provider})` : ''}`
                  : 'Briefing déterministe (aucune clé IA / service indisponible)'
              }
            >
              {result.ai ? <Sparkles className="w-2.5 h-2.5" /> : <FileText className="w-2.5 h-2.5" />}
              {result.ai ? 'IA' : 'basique'}
            </span>
          )}

          {/* Copier (au bout, discret). */}
          {hasResult && (
            <button
              type="button"
              onClick={() => void copier()}
              className="ml-auto flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] hover:text-[var(--accent)] transition"
              title="Copier le briefing"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copié' : 'Copier'}
            </button>
          )}
        </div>
      </div>

      {/* ── Corps : briefing ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3">
        {/* Chargement */}
        {loading && (
          <div className="flex flex-col items-center gap-2 text-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
            <p className="text-[11px] font-mono text-[var(--muted)]">Analyse de la situation…</p>
          </div>
        )}

        {/* Erreur (rare : requestBriefing ne throw pas). */}
        {!loading && error && (
          <div className="flex flex-col items-center gap-2 text-center py-8 px-4">
            <AlertTriangle className="w-5 h-5 text-[#e0b45f]" />
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">{error}</p>
          </div>
        )}

        {/* Résultat : texte FR, sauts de ligne respectés. */}
        {!loading && !error && hasResult && (
          <p className="text-[11px] leading-relaxed text-white/90 whitespace-pre-wrap break-words">
            {result?.briefing}
          </p>
        )}

        {/* État initial (rien encore généré). */}
        {!loading && !error && !hasResult && (
          <div className="flex flex-col items-center gap-2 text-center py-8 px-4">
            <Info className="w-5 h-5 text-[var(--faint)]" />
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
              Lance « Générer le briefing » pour un résumé de situation à partir des couches
              actuellement visibles sur la carte.
            </p>
          </div>
        )}
      </div>

      {/* ── Pied : rappel du cadre ARPD ── */}
      <div className="px-3 py-2 border-t border-[var(--border-primary)]">
        <p className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] leading-relaxed">
          Analyse de situation · données publiques · aucun ciblage de personne · cadre ARPD
        </p>
      </div>
    </motion.div>
  );
}

export default memo(BriefingPanel);
