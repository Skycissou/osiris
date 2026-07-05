'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  NewsPanel.tsx — Panneau « Fil d'actualité géopolitique » (OSIRIS V4 · cockpit)
//  Agent PANNEAU NEWS
//
//  RÔLE
//  ────
//  Affiche les derniers articles de presse (24 h) autour d'un thème géopolitique
//  / sécurité, servis par la route interne /news (agrégateur GDELT, gratuit, sans
//  clé). Petit champ de filtre thème + sélecteur de langue FR/EN (défaut FR).
//  Chaque article : titre cliquable (nouvel onglet), source (domaine + pays),
//  date relative FR (« il y a 2 h »), vignette si disponible.
//
//  CHARTE V3 (cohérence graphique, calque d'OsintPanel / RegionDossierPanel) :
//  panneau glassmorphism `glass-panel`, libellés techniques en `font-mono`,
//  accent `--accent`, apparition douce depuis la droite (framer-motion),
//  scrollbar `styled-scrollbar`, bouton fermer identique.
//
//  CADRE DÉFENSIF ARPD : agrégation d'actualités PUBLIQUES déjà diffusées par les
//  médias, veille géopolitique légale. Aucune donnée privée, aucun ciblage.
//  Rappel affiché en pied de panneau.
//
//  INTÉGRATION (dans src/app/page.tsx) — même schéma que les autres panneaux :
//    1) État d'ouverture :
//         const [newsOpen, setNewsOpen] = useState(false);
//    2) Bouton dans la barre d'outils (ex. à côté du bouton OSINT) :
//         <button onClick={() => setNewsOpen(true)} title="Fil d'actualité">
//           News
//         </button>
//    3) Montage du panneau (idéalement sous <AnimatePresence>, à côté de
//       <OsintPanel> / <ResultsPanel>) :
//         <AnimatePresence>
//           {newsOpen && (
//             <NewsPanel onClose={() => setNewsOpen(false)} isMobile={isMobile} />
//           )}
//         </AnimatePresence>
//    Chargement paresseux possible comme les autres panneaux :
//       const NewsPanel = dynamic(() => import('@/components/NewsPanel'), { ssr: false });
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X,
  Newspaper,
  Loader2,
  RefreshCw,
  ExternalLink,
  Globe,
  Info,
  AlertTriangle,
  Search,
} from 'lucide-react';

// ── Props ─────────────────────────────────────────────────────────────────────
interface NewsPanelProps {
  /** Ferme le panneau (branché sur setNewsOpen(false)). */
  onClose: () => void;
  /** Layout compact mobile (mêmes règles que les autres panneaux). */
  isMobile?: boolean;
}

// ── Types du contrat de la route /news ────────────────────────────────────────
interface NewsArticle {
  title: string;
  url: string;
  domain?: string;
  seendate?: string;
  sourcecountry?: string;
  language?: string;
  socialimage?: string;
}

// Préfixe basePath (comme tous les appels internes du cockpit).
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Timeout local de l'appel /news (ms). */
const FETCH_TIMEOUT_MS = 12_000;

// ── Helpers de présentation ───────────────────────────────────────────────────
/**
 * Parse une date GDELT au format `YYYYMMDDThhmmssZ` (ex. « 20260705T142230Z »).
 * Renvoie un Date valide, ou null si le format n'est pas reconnu (on tente aussi
 * un parse ISO natif en repli).
 */
function parseSeenDate(raw?: string): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(raw.trim());
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const iso = new Date(raw);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

/** Date → libellé relatif FR compact (« à l'instant », « il y a 2 h », « il y a 3 j »). */
function relativeFr(date: Date | null): string {
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "à l'instant";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `il y a ${day} j`;
  const wk = Math.round(day / 7);
  return `il y a ${wk} sem`;
}

// ── Carte d'un article ────────────────────────────────────────────────────────
function ArticleCard({ article }: { article: NewsArticle }) {
  const when = relativeFr(parseSeenDate(article.seendate));
  const source = [article.domain, article.sourcecountry].filter(Boolean).join(' · ');

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-2.5 rounded-lg border border-[var(--border-primary)] bg-white/[0.015] hover:bg-white/[0.04] px-2.5 py-2 transition-colors"
    >
      {/* Vignette (si fournie par la source). Décorative → alt vide. */}
      {article.socialimage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.socialimage}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-14 h-14 flex-shrink-0 rounded-md object-cover bg-black/30 border border-[var(--border-primary)]"
          onError={(e) => {
            // Vignette cassée → on la masque proprement (pas de carré vide).
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <span className="text-[12px] leading-snug text-white/90 group-hover:text-white break-words line-clamp-3">
            {article.title}
          </span>
          <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 text-[var(--faint)] group-hover:text-[var(--accent)]" />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {source && (
            <span className="text-[9px] font-mono uppercase tracking-wider text-[var(--accent)] truncate max-w-full">
              {source}
            </span>
          )}
          {when && (
            <>
              {source && <span className="text-[9px] font-mono text-[var(--faint)]">·</span>}
              <span className="text-[9px] font-mono text-[var(--faint)]">{when}</span>
            </>
          )}
        </div>
      </div>
    </a>
  );
}

// ── Panneau principal ─────────────────────────────────────────────────────────
function NewsPanel({ onClose, isMobile }: NewsPanelProps) {
  // Thème saisi (contrôlé) + thème réellement appliqué à la dernière requête.
  const [theme, setTheme] = useState('');
  const [lang, setLang] = useState<'fr' | 'en'>('fr'); // défaut FR (charte)
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // AbortController de la requête en cours : annulé si nouvelle recherche / démontage.
  const abortRef = useRef<AbortController | null>(null);

  /**
   * charger — appelle la route interne /news (préfixée par le basePath) et met à
   * jour la liste. Ne throw jamais : toute erreur devient un message FR affiché.
   */
  const charger = useCallback(async () => {
    // Annule une requête précédente encore en vol.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const prefix = BASE_PATH.replace(/\/$/, '');
    const params = new URLSearchParams({ lang });
    const q = theme.trim();
    if (q) params.set('q', q);
    const url = `${prefix}/news?${params.toString()}`;

    // Timeout local combiné à l'éventuel abort externe (nouvelle recherche).
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const payload = (await res.json()) as { articles?: NewsArticle[]; error?: string };
      if (controller.signal.aborted) return;
      const list = Array.isArray(payload.articles) ? payload.articles : [];
      setArticles(list);
      // Message doux : erreur explicite, ou liste vide sans erreur.
      if (payload.error) setError(payload.error);
      else if (list.length === 0) setError('Aucun article trouvé sur ce thème (24 h).');
    } catch (err) {
      if (controller.signal.aborted) return;
      const aborted = err instanceof Error && err.name === 'AbortError';
      setError(aborted ? 'Délai dépassé, réessaie.' : 'Échec du chargement des actualités.');
      setArticles([]);
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [theme, lang]);

  // Chargement initial + rechargement à chaque changement de langue.
  // (Le changement de thème passe par « Entrée » ou le bouton Rafraîchir.)
  useEffect(() => {
    void charger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // Focus auto du champ à l'ouverture.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Annulation propre au démontage (évite les setState sur composant démonté).
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void charger();
    },
    [charger],
  );

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[207] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col"
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
          <Newspaper className="w-3.5 h-3.5" />
          Fil d'actualité géopolitique
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Barre de filtre : thème + langue + rafraîchir ── */}
      <form onSubmit={onSubmit} className="px-3 py-2.5 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Thème : Ukraine, Sahel, cyber… (vide = géopolitique)"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-black/25 border border-[var(--border-primary)] rounded-md px-2.5 py-1.5 text-[12px] font-mono text-white placeholder:text-[var(--faint)] outline-none focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition"
          />
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Filtrer"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Sélecteur de langue FR/EN + bouton Rafraîchir */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Langue des sources">
            <Globe className="w-3 h-3 text-[var(--faint)]" />
            {(['fr', 'en'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                className={
                  'rounded px-2 py-0.5 text-[9px] font-mono uppercase tracking-widest border transition ' +
                  (lang === code
                    ? 'text-[var(--accent-bright)] border-[var(--accent-line)] bg-[var(--accent-soft)]'
                    : 'text-[var(--faint)] border-[var(--border-primary)] hover:text-white/70')
                }
              >
                {code}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void charger()}
            disabled={loading}
            className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] hover:text-[var(--accent)] disabled:opacity-40 transition"
            title="Rafraîchir"
          >
            <RefreshCw className={'w-3 h-3 ' + (loading ? 'animate-spin' : '')} />
            Rafraîchir
          </button>
        </div>
      </form>

      {/* ── Corps : liste des articles ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3 flex flex-col gap-2">
        {/* Chargement initial (aucun article encore) */}
        {loading && articles.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
            <p className="text-[11px] font-mono text-[var(--muted)]">Chargement des actualités…</p>
          </div>
        )}

        {/* Erreur / liste vide */}
        {!loading && error && articles.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-8 px-4">
            <AlertTriangle className="w-5 h-5 text-[#e0b45f]" />
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">{error}</p>
          </div>
        )}

        {/* État vide (ni chargement, ni erreur, ni articles) — cas défensif */}
        {!loading && !error && articles.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-center py-8 px-4">
            <Info className="w-5 h-5 text-[var(--faint)]" />
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
              Saisis un thème puis valide, ou laisse vide pour le fil géopolitique.
            </p>
          </div>
        )}

        {/* Articles */}
        {articles.map((a) => (
          <ArticleCard key={a.url} article={a} />
        ))}
      </div>

      {/* ── Pied : rappel du cadre ARPD ── */}
      <div className="px-3 py-2 border-t border-[var(--border-primary)]">
        <p className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)] leading-relaxed">
          Agrégation d'actus publiques (GDELT) · veille géopolitique légale · cadre ARPD
        </p>
      </div>
    </motion.div>
  );
}

export default memo(NewsPanel);
