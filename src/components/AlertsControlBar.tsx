'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  AlertsControlBar — barre de contrôle de la couche « Alertes disparitions ».
//  Spec Claude chat v1.1 (§11 badge fraîcheur + §12 chips filtres) + liste.
//  Affichée quand la couche est active, SOUS la barre de recherche (pas de
//  chevauchement). Filtre multi-sélection catégorie + source, badge de synchro,
//  compteur « sur carte / sans position », et LISTE dépliable des avis filtrés
//  (indispensable : Interpol Yellow n'a presque jamais de coordonnées → sinon
//  invisibles sur la carte).
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useEffect, useMemo, useState } from 'react';
import type { AlertPoint } from './OsirisMap';

export interface AlertsHealth {
  last_sync_at: number | null;
  per_source?: Record<string, number>;
  active_count?: number;
}

interface Props {
  alerts: AlertPoint[]; // avis bruts (avant filtre) — compteurs des chips
  filtered: AlertPoint[]; // avis après filtre — liste + compteurs carte/liste
  catFilter: string[];
  srcFilter: string[];
  onToggleCat: (c: string) => void;
  onToggleSrc: (s: string) => void;
  onRefresh?: () => void; // bouton 🔄 : force un re-poll immédiat
  health: AlertsHealth | null;
  isMobile?: boolean;
}

const CATS: { slug: string; label: string }[] = [
  { slug: 'fugue', label: 'Fugue' },
  { slug: 'disparition_inquietante', label: 'Disp. inquiétante' },
  { slug: 'enlevement_parental', label: 'Enl. parental' },
  { slug: 'disparition', label: 'Disparition' },
  { slug: 'enlevement', label: 'Enlèvement' },
  { slug: 'appel_temoins', label: 'Appel témoins' },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map((c) => [c.slug, c.label]));
const SRCS: { slug: string; label: string }[] = [
  { slug: 'interpol_yellow', label: 'Interpol' },
  { slug: 'x116000', label: '116000' },
];
const SRC_LABEL: Record<string, string> = Object.fromEntries(SRCS.map((s) => [s.slug, s.label]));

function freshness(lastSync: number | null): { color: string; label: string } {
  if (!lastSync) return { color: '#ff6b74', label: 'aucune synchro' };
  const min = Math.floor((Date.now() - lastSync) / 60_000);
  const color = min < 20 ? '#7cffb2' : min <= 45 ? '#ffb23e' : '#ff6b74';
  return { color, label: `synchro il y a ${min} min` };
}

function Chip({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={
        'rounded-full px-2.5 py-0.5 text-[10px] font-mono border transition whitespace-nowrap ' +
        (on ? 'text-[#1a1205] bg-[#ffb23e] border-[#ffb23e]' : 'text-[var(--faint)] border-[var(--border-primary)] hover:text-white/80')
      }
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

function AlertsControlBar({ alerts, filtered, catFilter, srcFilter, onToggleCat, onToggleSrc, onRefresh, health, isMobile }: Props) {
  const [listOpen, setListOpen] = useState(false);
  const [spin, setSpin] = useState(false);
  // Fait VIVRE le badge : re-render toutes les 30 s pour que « il y a X min »
  // avance à l'écran sans attendre le prochain poll (preuve visuelle de liveness).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 30_000);
    return () => clearInterval(id);
  }, []);
  const doRefresh = () => {
    if (!onRefresh) return;
    onRefresh();
    setSpin(true);
    setTimeout(() => setSpin(false), 700);
  };

  const { catCounts, srcCounts } = useMemo(() => {
    const cc: Record<string, number> = {};
    const sc: Record<string, number> = {};
    for (const a of alerts) {
      const c = a.categorie || 'disparition';
      cc[c] = (cc[c] || 0) + 1;
      sc[a.source] = (sc[a.source] || 0) + 1;
    }
    return { catCounts: cc, srcCounts: sc };
  }, [alerts]);

  const onMap = useMemo(() => filtered.filter((a) => typeof a.lat === 'number' && typeof a.lon === 'number').length, [filtered]);
  const noPos = filtered.length - onMap;
  const fr = freshness(health?.last_sync_at ?? null);

  return (
    <div
      className="absolute z-[206] pointer-events-auto glass-panel border border-[var(--border-primary)] rounded-lg px-3 py-2 flex flex-col gap-1.5"
      style={{
        top: isMobile ? '110px' : '118px', // SOUS la barre de recherche (fini le chevauchement)
        left: isMobile ? '12px' : '50%',
        transform: isMobile ? 'none' : 'translateX(-50%)',
        right: isMobile ? '12px' : 'auto',
        maxWidth: isMobile ? undefined : '660px',
        maxHeight: 'calc(100vh - 200px)',
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#ffb23e]">🟡 Alertes</span>
        <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: fr.color }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: fr.color, display: 'inline-block' }} />
          {fr.label}
        </span>
        {onRefresh && (
          <button
            type="button"
            onClick={doRefresh}
            title="Rafraîchir maintenant (maj auto toutes les 90 s)"
            aria-label="Rafraîchir les alertes"
            className="text-[11px] leading-none text-[var(--faint)] hover:text-white/90 transition"
            style={{ transform: spin ? 'rotate(360deg)' : 'none', transition: 'transform .6s ease' }}
          >
            🔄
          </button>
        )}
        <span className="text-white/15">|</span>
        <span className="text-[10px] font-mono text-white/70">📍 {onMap} sur carte · 📋 {noPos} sans position</span>
        {/* Légende récence (échelle de couleur) */}
        <span className="flex items-center gap-1 text-[9px] font-mono text-[var(--faint)]">
          récent
          <span style={{ width: 46, height: 7, borderRadius: 4, display: 'inline-block', background: 'linear-gradient(90deg,#ff2d2d,#ff9f2e,#ffc93e,#e6d27a)' }} />
          ancien
        </span>
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          className={'ml-auto rounded px-2 py-0.5 text-[10px] font-mono border transition ' + (listOpen ? 'text-[#1a1205] bg-[#ffb23e] border-[#ffb23e]' : 'text-[var(--faint)] border-[var(--border-primary)] hover:text-white/80')}
        >
          Liste ({filtered.length})
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {CATS.filter((c) => (catCounts[c.slug] || 0) > 0 || catFilter.includes(c.slug)).map((c) => (
          <Chip key={c.slug} label={c.label} count={catCounts[c.slug] || 0} on={catFilter.includes(c.slug)} onClick={() => onToggleCat(c.slug)} />
        ))}
        <span className="text-white/15">|</span>
        {SRCS.filter((s) => (srcCounts[s.slug] || 0) > 0 || srcFilter.includes(s.slug)).map((s) => (
          <Chip key={s.slug} label={s.label} count={srcCounts[s.slug] || 0} on={srcFilter.includes(s.slug)} onClick={() => onToggleSrc(s.slug)} />
        ))}
      </div>

      {/* Liste dépliable — TOUS les avis filtrés (géolocalisés ou non). */}
      {listOpen && (
        <div className="mt-1 overflow-y-auto styled-scrollbar flex flex-col gap-1" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          {filtered.length === 0 && <div className="text-[11px] font-mono text-[var(--faint)] py-2">Aucun avis pour ce filtre.</div>}
          {filtered.map((a) => {
            const leve = a.statut === 'levee';
            const geo = typeof a.lat === 'number' && typeof a.lon === 'number';
            const t = a.date_publication ? Date.parse(a.date_publication) : NaN;
            const ageH = Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : Infinity;
            const rc = leve ? '#7f8da1' : ageH < 24 ? '#ff2d2d' : ageH < 72 ? '#ff9f2e' : ageH < 168 ? '#ffc93e' : '#8a94a3';
            return (
              <div key={a.id} className="flex items-baseline gap-2 py-1 border-b border-white/[0.05]">
                <span style={{ width: 7, height: 7, borderRadius: 99, background: rc, display: 'inline-block', flexShrink: 0 }} title={geo ? 'sur la carte' : 'sans position'} />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-mono text-white/90 truncate">
                    {leve ? '(avis levé)' : (a.nom_affiche || 'Personne recherchée')}
                    {a.age ? <span className="text-[var(--faint)]"> · {a.age} ans</span> : null}
                  </div>
                  <div className="text-[9px] font-mono text-[var(--faint)] truncate">
                    {geo ? '📍 ' : ''}{CAT_LABEL[a.categorie || 'disparition'] || a.categorie} · {SRC_LABEL[a.source] || a.source}
                    {a.lieu_texte ? ` · ${a.lieu_texte}` : ''}
                  </div>
                </div>
                {!leve && a.url_source && (
                  <a href={a.url_source} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-[var(--accent)] hover:text-[var(--accent-bright)] flex-shrink-0">avis ↗</a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default memo(AlertsControlBar);
