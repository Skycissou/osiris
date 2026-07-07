'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  /cles-api — Page DÉDIÉE « Clés API » (OSIRIS V4 · cockpit)
//  Créée le 07/07 à la demande de Cissou (« l'onglet API mérite une page
//  dédiée ») en remplacement du panneau flottant par-dessus la carte
//  (KeysPanel — ARCHIVÉ, dormant).
//
//  URL finale : /cockpit/cles-api (basePath Next = /cockpit — JAMAIS /api/*,
//  Traefik strip /api vers le FastAPI V3 → 404).
//
//  CONTENU : bandeau titre + compteur « X / N clés configurées » + note de
//  sécurité + les cartes de services (KeysManager, source unique partagée)
//  + liens retour (cockpit / accueil).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import KeysManager from '@/components/KeysManager';
import { OSIRIS_VERSION } from '@/lib/version';

export default function ClesApiPage() {
  // Compteur global, alimenté par KeysManager (hydratation + chaque save/clear).
  const [count, setCount] = useState<{ configured: number; total: number } | null>(null);
  const onCountChange = useCallback((configured: number, total: number) => {
    setCount({ configured, total });
  }, []);

  return (
    <main className="min-h-screen bg-[var(--bg,#070a0f)] text-white styled-scrollbar">
      <div className="mx-auto max-w-[860px] px-5 py-8 md:py-12">
        {/* ── Fil de retour ── */}
        <div className="flex items-center gap-3 mb-8">
          <Link
            href="/"
            className="glass-panel hover-lift inline-flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-bright)] hover:text-[var(--accent)] transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Cockpit carte
          </Link>
          {/* Ancre native hors basePath → racine V3 (l'accueil). */}
          <a
            href="/"
            className="glass-panel hover-lift inline-flex items-center gap-1.5 rounded-[12px] px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--muted)] hover:text-white transition-colors"
          >
            Accueil OSIRIS
          </a>
          <span className="ml-auto text-[9px] font-mono tracking-[0.2em] uppercase text-[var(--faint)]">
            {OSIRIS_VERSION}
          </span>
        </div>

        {/* ── En-tête ── */}
        <header className="mb-6">
          <h1 className="flex items-center gap-2.5 text-xl md:text-2xl font-bold font-mono tracking-[0.18em] text-[var(--accent)]">
            <KeyRound className="w-5 h-5" />
            CLÉS API
          </h1>
          <p className="mt-2 text-[12px] font-mono text-[var(--muted)] leading-relaxed max-w-[560px]">
            Fournis tes propres clés directement dans l&apos;app — sans redéploiement, sans
            fichier <span className="text-white/70">.env</span>. Chaque service documente à quoi
            sert la clé, où l&apos;obtenir et son coût.
          </p>

          {/* Compteur de statut (client only — s'affiche après hydratation) */}
          {count && (
            <div className="mt-3 inline-flex items-center gap-2 glass-panel rounded-full px-3.5 py-1.5">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: count.configured > 0 ? 'var(--green)' : 'var(--faint)' }}
              />
              <span className="text-[10px] font-mono uppercase tracking-widest text-white/80">
                {count.configured} / {count.total} clés configurées
              </span>
            </div>
          )}
        </header>

        {/* ── Note de sécurité ── */}
        <div className="glass-panel rounded-lg px-4 py-3 mb-6 flex items-start gap-2.5">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--accent)]" />
          <p className="text-[10px] font-mono text-[var(--muted)] leading-relaxed">
            Tes clés sont stockées <span className="text-[var(--accent)]">localement</span> dans
            CE navigateur (jamais sur le serveur, jamais partagées à un tiers) et envoyées
            uniquement à nos routes internes, qui relaient vers la source. Usage personnel
            enquêteur, sur un poste de confiance. Effaçables à tout moment.
          </p>
        </div>

        {/* ── Cartes de services (source unique partagée) ── */}
        <KeysManager onCountChange={onCountChange} />

        {/* ── Pied ── */}
        <footer className="mt-8 pt-4 border-t border-white/10 text-[9px] font-mono uppercase tracking-widest text-[var(--faint)]">
          OSIRIS · données publiques FR · cadre défensif ARPD
        </footer>
      </div>
    </main>
  );
}
