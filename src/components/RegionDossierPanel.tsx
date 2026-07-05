'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  RegionDossierPanel.tsx — Panneau « Dossier de zone » (OSIRIS V4 · cockpit)
//  Agent C · V4.003
//
//  RÔLE
//  ────
//  Affiche le dossier de zone produit par le hook `useRegionDossier` après un
//  clic droit sur la carte : localisation administrative, fiche pays et
//  gouvernance. Toutes les données sont PUBLIQUES (usage défensif / ARPD).
//
//  CHARTE V3 (cohérence graphique) : panneau glassmorphism `glass-panel`,
//  libellés techniques en `IBM Plex Mono` (--font-hud), accent `--accent`,
//  apparition douce depuis la droite (framer-motion). Même gabarit que
//  <ResultsPanel> (position, bouton fermer, scrollbar `styled-scrollbar`).
//
//  INTÉGRATION (dans src/app/page.tsx) :
//    const { dossier, loading, error, open, close } = useRegionDossier();
//    const handleRightClick = useCallback((c) => open(c), [open]);   // remplace le TODO
//    // ... dans le JSX, à côté de <ResultsPanel> :
//    {(dossier || loading) && (
//      <RegionDossierPanel dossier={dossier} loading={loading} error={error} onClose={close} />
//    )}
//  Le panneau se monte dès que `dossier` OU `loading` est vrai, et se démonte
//  via `onClose` (qui appelle `close()` du hook).
// ─────────────────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { motion } from 'framer-motion';
import { X, MapPin, Globe2, Landmark, Loader2 } from 'lucide-react';
import type { RegionDossier } from '@/lib/regionDossier';

interface RegionDossierPanelProps {
  /** Dossier à afficher (null tant que la collecte n'a rien produit). */
  dossier: RegionDossier | null;
  /** Collecte en cours → affiche l'état « Analyse de la zone… ». */
  loading: boolean;
  /** Message d'erreur FR si toutes les sources ont échoué. */
  error: string | null;
  /** Ferme le panneau (branché sur `close()` du hook). */
  onClose: () => void;
  isMobile?: boolean;
}

// ── Ligne label → valeur (libellé mono à gauche, valeur claire à droite) ──────
function Ligne({ label, value }: { label: string; value?: string }) {
  if (!value) return null; // champ absent (dégradation douce) → ligne masquée
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] flex-shrink-0">
        {label}
      </span>
      <span className="text-[12px] font-mono text-white/90 text-right break-words">{value}</span>
    </div>
  );
}

// ── Titre de section (Localisation / Pays / Gouvernance) ──────────────────────
function SectionTitre({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--accent-bright)] pb-1 mb-1 border-b border-white/10">
      {icon}
      {label}
    </div>
  );
}

/** Formate un nombre à la française (séparateur de milliers par espace fine). */
function nombreFr(n?: number): string | undefined {
  if (typeof n !== 'number') return undefined;
  return n.toLocaleString('fr-FR');
}

function RegionDossierPanel({ dossier, loading, error, onClose, isMobile }: RegionDossierPanelProps) {
  // Coordonnées formatées (repli sur le point interrogé, même en erreur).
  const coords = dossier?.coords;
  const coordsFmt = coords ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : '—';

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[206] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col styled-scrollbar"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        width: isMobile ? 'auto' : '320px',
        maxHeight: isMobile ? '46vh' : 'calc(100vh - 240px)',
      }}
    >
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          Dossier de zone
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Corps ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3 flex flex-col gap-4">
        {/* Coordonnées interrogées (toujours visibles) */}
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--accent-bright)] tabular-nums">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
          {coordsFmt}
        </div>

        {/* État : chargement */}
        {loading && (
          <div className="flex items-center gap-2 text-[12px] font-mono text-[var(--muted)] py-4">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
            Analyse de la zone…
          </div>
        )}

        {/* État : erreur (aucune source exploitable) */}
        {!loading && error && (
          <div className="text-[11px] font-mono text-[#e0736f] bg-[#e0736f]/10 border border-[#e0736f]/25 rounded px-2.5 py-2">
            {error}
          </div>
        )}

        {/* Contenu du dossier */}
        {!loading && dossier && (
          <>
            {/* SECTION Localisation */}
            <section>
              <SectionTitre icon={<MapPin className="w-3 h-3" />} label="Localisation" />
              <Ligne label="Commune" value={dossier.commune} />
              <Ligne label="Région" value={dossier.region} />
              <Ligne label="Pays" value={dossier.pays} />
              {!dossier.commune && !dossier.region && !dossier.pays && (
                <div className="text-[10px] font-mono text-[var(--faint)] py-0.5">Non renseigné.</div>
              )}
            </section>

            {/* SECTION Pays */}
            {(dossier.capitale || dossier.population || dossier.superficie || dossier.monnaie || dossier.drapeau) && (
              <section>
                <SectionTitre icon={<Globe2 className="w-3 h-3" />} label="Pays" />
                {/* Drapeau (emoji) + nom pays, si disponibles */}
                {dossier.drapeau && (
                  <div className="flex items-center gap-2 py-1">
                    {/* Emoji drapeau ou, en repli, URL d'image */}
                    {dossier.drapeau.startsWith('http') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={dossier.drapeau} alt="Drapeau" className="w-6 h-auto rounded-sm" />
                    ) : (
                      <span className="text-xl leading-none">{dossier.drapeau}</span>
                    )}
                    {dossier.pays && (
                      <span className="text-[13px] font-mono text-white">{dossier.pays}</span>
                    )}
                  </div>
                )}
                <Ligne label="Capitale" value={dossier.capitale} />
                <Ligne label="Population" value={nombreFr(dossier.population)} />
                <Ligne
                  label="Superficie"
                  value={dossier.superficie ? `${nombreFr(dossier.superficie)} km²` : undefined}
                />
                <Ligne label="Monnaie" value={dossier.monnaie} />
              </section>
            )}

            {/* SECTION Gouvernance */}
            {(dossier.chefEtat || dossier.chefGouvernement) && (
              <section>
                <SectionTitre icon={<Landmark className="w-3 h-3" />} label="Gouvernance" />
                <Ligne label="Chef d'État" value={dossier.chefEtat} />
                <Ligne label="Chef du gouv." value={dossier.chefGouvernement} />
              </section>
            )}

            {/* Badge sources (crédit + rappel usage public/défensif) */}
            {dossier.sources.length > 0 && (
              <div className="pt-2 mt-1 border-t border-white/5">
                <div className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] mb-1">
                  Sources publiques
                </div>
                <div className="flex flex-wrap gap-1">
                  {dossier.sources.map((s) => (
                    <span
                      key={s}
                      /* Badge = style .tag de la landing (accent-soft + accent-line, coins doux) */
                      className="text-[9px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-md px-2 py-0.5"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}

export default memo(RegionDossierPanel);
