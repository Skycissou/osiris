'use client';

/**
 * ConsentModal.tsx — Modale de consentement « couches sensibles » (forme 2).
 * ---------------------------------------------------------------------------
 * Fichier CLEAN-ROOM, licence MIT (repo OSIRIS). Charte graphique V3.
 *
 * RÔLE
 *   Barrière de consentement EXPLICITE avant l'accès aux couches sensibles
 *   (VIP, CCTV, brouillage GPS, scanners radio, SIGINT…) de la forme 2. Le but
 *   n'est pas décoratif : c'est le verrou n°2 (runtime) décrit dans `forms.ts`.
 *   Tant que l'utilisateur n'a pas cliqué « J'ai compris, activer », aucune
 *   couche sensible ne doit s'activer.
 *
 * ─── Comment brancher (câblage à faire dans page.tsx / LayerPanel) ───
 *   import ConsentModal from '@/components/ConsentModal';
 *   import { hasConsented, giveConsent, isSensitiveLayer } from '@/lib/forms';
 *
 *   const [askConsent, setAskConsent] = useState(false);
 *   const [pending, setPending] = useState<string | null>(null);
 *
 *   function onToggleLayer(layer) {
 *     // Au 1er toggle d'une couche form:2, si pas encore consenti → modale.
 *     if (isSensitiveLayer(layer) && !hasConsented()) {
 *       setPending(layer.id);
 *       setAskConsent(true);
 *       return; // on n'active PAS encore
 *     }
 *     activate(layer.id);
 *   }
 *
 *   <ConsentModal
 *     open={askConsent}
 *     onAccept={() => { giveConsent(); setAskConsent(false); if (pending) activate(pending); }}
 *     onCancel={() => { setAskConsent(false); setPending(null); }}
 *   />
 *
 *   Le consentement est PERSISTANT (localStorage) et RÉVOCABLE via
 *   `revokeConsent()` — après révocation, re-désactiver les couches sensibles.
 */

import { memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Check, X, Eye } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────
//  Charte V3 (valeurs figées ici pour un rendu self-contained, sans dépendre
//  de la présence des variables CSS globales dans le contexte de montage).
// ──────────────────────────────────────────────────────────────────────────
const C = {
  panelBg: 'rgba(13, 18, 27, 0.92)', // glassmorphism V3
  accent: '#54bdde',
  accentSoft: 'rgba(84, 189, 222, 0.12)',
  accentLine: 'rgba(84, 189, 222, 0.34)',
  amber: '#d6a445',
  red: '#db6f78',
  ink: '#eaeff6',
  inkDim: '#c2cbd8',
  muted: '#7f8da1',
  fontBody: "'IBM Plex Sans', -apple-system, sans-serif",
  fontMono: "'IBM Plex Mono', 'Courier New', monospace",
} as const;

export interface ConsentModalProps {
  /** Contrôle l'affichage. false ⇒ rien n'est rendu (démontage animé). */
  open: boolean;
  /** Appelé quand l'utilisateur accepte. Le parent doit y appeler giveConsent(). */
  onAccept: () => void;
  /** Appelé quand l'utilisateur annule ou ferme la modale (fond, Échap, croix). */
  onCancel: () => void;
}

/** Exemples de couches concernées, listés dans le texte pédagogique. */
const SENSITIVE_EXAMPLES = [
  'Aéronefs VIP (watchlist)',
  'Caméras (CCTV)',
  'Brouillage GPS',
  'Scanners radio',
  'Maillage SIGINT',
] as const;

function ConsentModalImpl({ open, onAccept, onCancel }: ConsentModalProps) {
  // Clic sur le fond assombri = annuler (mais pas les clics DANS la modale).
  const onBackdropClick = useCallback(() => onCancel(), [onCancel]);
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // ── Fond assombri (overlay) ──
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          onClick={onBackdropClick}
          role="presentation"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
            background: 'rgba(3, 6, 11, 0.62)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
          }}
        >
          <motion.div
            // ── Panneau modale (apparition douce) ──
            role="dialog"
            aria-modal="true"
            aria-labelledby="osiris-consent-title"
            aria-describedby="osiris-consent-desc"
            onClick={stop}
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{
              width: '90%',
              maxWidth: 460,
              background: C.panelBg,
              backdropFilter: 'blur(24px) saturate(1.3)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
              border: `1px solid ${C.accentLine}`,
              borderRadius: 16,
              boxShadow: '0 18px 60px rgba(0, 0, 0, 0.55), 0 0 40px rgba(84, 189, 222, 0.08)',
              color: C.ink,
              fontFamily: C.fontBody,
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.1rem',
            }}
          >
            {/* ── En-tête : pastille + titre ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <div
                aria-hidden
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: 'rgba(214, 164, 69, 0.13)',
                  border: '1px solid rgba(214, 164, 69, 0.34)',
                  flexShrink: 0,
                }}
              >
                <ShieldAlert size={22} color={C.amber} strokeWidth={2} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span
                  style={{
                    fontFamily: C.fontMono,
                    fontSize: 9,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: C.amber,
                  }}
                >
                  Forme ② · Mode enquêteur
                </span>
                <h2
                  id="osiris-consent-title"
                  style={{ margin: 0, fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.25 }}
                >
                  Couches sensibles — mode enquêteur
                </h2>
              </div>
            </div>

            {/* ── Corps pédagogique ── */}
            <div
              id="osiris-consent-desc"
              style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: 13.5, lineHeight: 1.55, color: C.inkDim }}
            >
              <p style={{ margin: 0 }}>
                Vous vous apprêtez à activer des couches <strong style={{ color: C.ink }}>sensibles</strong> :
                agrégation et cartographie de <strong style={{ color: C.ink }}>données publiques</strong> (VIP,
                CCTV, brouillage, scanners, SIGINT…). Ces informations sont ouvertes, mais leur mise en
                relation demande un usage <strong style={{ color: C.ink }}>responsable et défensif</strong>.
              </p>

              {/* Liste d'exemples des couches concernées */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.4rem',
                  padding: '0.65rem 0.75rem',
                  borderRadius: 10,
                  background: C.accentSoft,
                  border: `1px solid ${C.accentLine}`,
                }}
              >
                {SENSITIVE_EXAMPLES.map((label) => (
                  <span
                    key={label}
                    style={{
                      fontFamily: C.fontMono,
                      fontSize: 10.5,
                      letterSpacing: '0.02em',
                      color: C.accent,
                      padding: '2px 8px',
                      borderRadius: 999,
                      border: `1px solid ${C.accentLine}`,
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              <p style={{ margin: 0, display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <Eye size={16} color={C.accent} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
                <span>
                  Cadre <strong style={{ color: C.ink }}>ARPD</strong> : documentation et prévention
                  uniquement. <strong style={{ color: C.ink }}>Aucun ciblage</strong> de personne, aucune
                  exploitation offensive. L'accès est un <strong style={{ color: C.ink }}>choix explicite</strong>
                  {' '}de votre part, et il reste révocable à tout moment.
                </span>
              </p>
            </div>

            {/* ── Actions ── */}
            <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                onClick={onCancel}
                style={{
                  flex: '0 0 auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.4rem',
                  padding: '0.7rem 1.1rem',
                  borderRadius: 10,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: C.muted,
                  fontFamily: C.fontMono,
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s ease, color 0.2s ease',
                }}
              >
                <X size={15} aria-hidden /> Annuler
              </button>
              <button
                type="button"
                onClick={onAccept}
                autoFocus
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  padding: '0.7rem 1.1rem',
                  borderRadius: 10,
                  background: C.accentSoft,
                  border: `1px solid ${C.accentLine}`,
                  color: C.accent,
                  fontFamily: C.fontMono,
                  fontSize: 12.5,
                  fontWeight: 500,
                  letterSpacing: '0.06em',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s ease, background 0.2s ease',
                }}
              >
                <Check size={16} aria-hidden /> J&apos;ai compris, activer
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Modale de consentement mémoïsée (props stables ⇒ pas de re-render inutile). */
const ConsentModal = memo(ConsentModalImpl);
ConsentModal.displayName = 'ConsentModal';

export default ConsentModal;
