'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  KeysPanel.tsx — Panneau « Clés API » (OSIRIS V4 · cockpit)
//  Agent MODULE CLÉS API
//
//  RÔLE
//  ────
//  Laisse l'enquêteur saisir SES clés API directement dans l'app, sans
//  redéploiement. Chaque clé est stockée localement (localStorage) via
//  src/lib/apiKeys.ts et renvoyée en en-tête `x-osiris-key-<service>` aux
//  routes internes du cockpit (osintClient / liveData).
//
//  Le panneau est DOCUMENTÉ : pour chaque service on affiche le rôle, le coût,
//  un lien direct pour obtenir la clé, une procédure courte, un champ masqué,
//  et le statut (configurée / vide). Regroupé par catégorie.
//
//  CHARTE V3 (calque de OsintPanel / ResultsPanel / RegionDossierPanel) :
//  panneau glassmorphism `glass-panel`, libellés techniques en `IBM Plex Mono`
//  (font-mono), accent `--accent`, apparition douce depuis la droite
//  (framer-motion), scrollbar `styled-scrollbar`, bouton fermer identique.
//
//  SÉCURITÉ : clés en clair dans localStorage (poste de confiance), envoyées
//  UNIQUEMENT à nos routes serveur (même origine). Rappel affiché en pied.
//
//  INTÉGRATION (dans src/app/page.tsx) — même schéma que les autres panneaux :
//    1) État d'ouverture :
//         const [keysOpen, setKeysOpen] = useState(false);
//    2) Bouton / lien dans la sidebar (ex. .ck-navlink « Clés API ») :
//         <button onClick={() => setKeysOpen(true)} title="Clés API">Clés API</button>
//    3) Montage sous <AnimatePresence>, à côté des autres panneaux :
//         <AnimatePresence>
//           {keysOpen && (
//             <KeysPanel onClose={() => setKeysOpen(false)} isMobile={isMobile} />
//           )}
//         </AnimatePresence>
//    Chargement paresseux possible :
//       const KeysPanel = dynamic(() => import('@/components/KeysPanel'), { ssr: false });
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  KeyRound,
  ExternalLink,
  Save,
  Trash2,
  Eye,
  EyeOff,
  Info,
  CheckCircle2,
  Circle,
  ShieldCheck,
} from 'lucide-react';
import {
  API_KEY_SERVICES,
  getKey,
  setKey,
  clearKey,
  type ApiKeyService,
  type ApiKeyServiceMeta,
} from '@/lib/apiKeys';

// ── Props ─────────────────────────────────────────────────────────────────────
interface KeysPanelProps {
  /** Ferme le panneau (branché sur setKeysOpen(false)). */
  onClose: () => void;
  /** Layout compact mobile (mêmes règles que les autres panneaux). */
  isMobile?: boolean;
}

// ── Catégories d'affichage ────────────────────────────────────────────────────
//  On regroupe les services en 3 blocs lisibles. L'appartenance est déduite du
//  registre : forme 2 → « Sensibles » ; sinon FIRMS/AIS → « Couches », le reste
//  → « OSINT ». Un ordre stable est garanti par l'ordre du registre.
type Categorie = { id: string; titre: string; sous: string; couleur: string };

const CATEGORIES: Categorie[] = [
  {
    id: 'osint',
    titre: 'OSINT',
    sous: 'Boîte à outils — enrichissement de cibles',
    couleur: 'var(--accent)',
  },
  {
    id: 'couches',
    titre: 'Couches carto',
    sous: 'Sources de données géographiques',
    couleur: 'var(--green)',
  },
  {
    id: 'sensibles',
    titre: 'Sources sensibles (forme 2)',
    sous: 'Câblage variable selon le fournisseur',
    couleur: 'var(--violet)',
  },
];

/** Services rattachés aux « couches carto » (forme 1 mais non-OSINT). */
const COUCHES_SERVICES = new Set<ApiKeyService>(['firms', 'ais_url', 'ais_key']);

/** Détermine la catégorie d'un service à partir de ses métadonnées. */
function categorieDe(meta: ApiKeyServiceMeta): string {
  if (meta.form === 2) return 'sensibles';
  if (COUCHES_SERVICES.has(meta.service)) return 'couches';
  return 'osint';
}

// ── Carte d'un service (mémoïsée) ─────────────────────────────────────────────
interface ServiceRowProps {
  meta: ApiKeyServiceMeta;
}

/**
 * Ligne éditable d'un service : label + rôle + coût + statut + champ masqué +
 * lien « Obtenir la clé » + procédure + boutons Enregistrer / Effacer.
 * Chaque carte gère son propre état de saisie (indépendant des autres).
 */
const ServiceRow = memo(function ServiceRow({ meta }: ServiceRowProps) {
  // Valeur en cours d'édition (initialisée depuis localStorage au montage).
  const [value, setValue] = useState('');
  // Clé réellement persistée : pilote le statut « configurée / vide ».
  const [stored, setStored] = useState('');
  // Masquage du champ (type password ↔ text).
  const [reveal, setReveal] = useState(false);
  // Petit feedback visuel après enregistrement / effacement.
  const [flash, setFlash] = useState<'saved' | 'cleared' | null>(null);

  // Hydratation côté client uniquement (localStorage indispo en SSR).
  useEffect(() => {
    const k = getKey(meta.service);
    setValue(k);
    setStored(k);
  }, [meta.service]);

  // Efface le flash après un court délai.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const configured = stored.length > 0;
  const dirty = value.trim() !== stored;

  const enregistrer = useCallback(() => {
    const v = value.trim();
    setKey(meta.service, v);
    setStored(v);
    setValue(v);
    setFlash('saved');
  }, [meta.service, value]);

  const effacer = useCallback(() => {
    clearKey(meta.service);
    setStored('');
    setValue('');
    setReveal(false);
    setFlash('cleared');
  }, [meta.service]);

  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-white/[0.015] px-3 py-2.5">
      {/* En-tête : nom du service + statut + coût */}
      <div className="flex items-center gap-2 mb-1">
        {configured ? (
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-[var(--green)]" />
        ) : (
          <Circle className="w-3.5 h-3.5 flex-shrink-0 text-[var(--faint)]" />
        )}
        <span className="text-[11px] font-mono font-bold text-white/90">{meta.label}</span>
        <span className="ml-auto text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] border border-[var(--line-2)] rounded px-1.5 py-0.5">
          {meta.cost}
        </span>
      </div>

      {/* Rôle FR */}
      <p className="text-[10px] font-mono text-[var(--muted)] leading-relaxed mb-2">
        {meta.purpose}
      </p>

      {/* Champ de saisie masqué + bouton œil */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="relative flex-1 min-w-0">
          <input
            type={reveal ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={configured ? '•••••••••• (clé enregistrée)' : 'Colle ta clé ici…'}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className="w-full bg-black/25 border border-[var(--border-primary)] rounded-md pl-2.5 pr-8 py-1.5 text-[11px] font-mono text-white placeholder:text-[var(--faint)] outline-none focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            title={reveal ? 'Masquer' : 'Afficher'}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white transition-colors"
          >
            {reveal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Boutons Enregistrer / Effacer + feedback */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={enregistrer}
          disabled={!dirty}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Save className="w-3 h-3" />
          Enregistrer
        </button>
        <button
          type="button"
          onClick={effacer}
          disabled={!configured && !value}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--red)] border border-[var(--red-line)] bg-[var(--red-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <Trash2 className="w-3 h-3" />
          Effacer
        </button>

        {/* Feedback discret */}
        {flash === 'saved' && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--green)]">
            enregistré
          </span>
        )}
        {flash === 'cleared' && (
          <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--faint)]">
            effacé
          </span>
        )}
      </div>

      {/* Lien « Obtenir la clé » + procédure courte */}
      <div className="mt-2 pt-2 border-t border-white/[0.06]">
        {meta.url ? (
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--accent)] hover:text-[var(--accent-bright)] transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Obtenir la clé
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-[var(--faint)]">
            <Info className="w-3 h-3" />
            Source variable (voir procédure)
          </span>
        )}
        <p className="mt-1 text-[9px] font-mono text-[var(--faint)] leading-relaxed">
          {meta.howTo}
        </p>
      </div>
    </div>
  );
});

// ── Panneau principal ─────────────────────────────────────────────────────────
function KeysPanel({ onClose, isMobile }: KeysPanelProps) {
  // Regroupe le registre par catégorie une seule fois (registre figé).
  const groupes = useMemo(() => {
    return CATEGORIES.map((cat) => ({
      cat,
      services: API_KEY_SERVICES.filter((m) => categorieDe(m) === cat.id),
    })).filter((g) => g.services.length > 0);
  }, []);

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

      {/* ── Corps : services groupés par catégorie ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3 flex flex-col gap-4">
        {groupes.map(({ cat, services }) => (
          <section key={cat.id} className="flex flex-col gap-2">
            {/* Titre de catégorie */}
            <div className="flex items-baseline gap-2 border-b border-white/10 pb-1">
              <span
                className="text-[10px] font-mono font-bold uppercase tracking-widest"
                style={{ color: cat.couleur }}
              >
                {cat.titre}
              </span>
              <span className="text-[8px] font-mono uppercase tracking-wider text-[var(--faint)]">
                {cat.sous}
              </span>
            </div>

            {/* Cartes de services */}
            {services.map((meta) => (
              <ServiceRow key={meta.service} meta={meta} />
            ))}
          </section>
        ))}
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
