'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  AlertsControlBar — barre de contrôle de la couche « Alertes disparitions ».
//  Spec Claude chat v1.1 (§11 badge fraîcheur + §12 chips filtres).
//  Affichée quand la couche est active. Filtre multi-sélection par CATÉGORIE et
//  par SOURCE (vide = tout), compteur par chip, + badge de fraîcheur de synchro.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useMemo } from 'react';
import type { AlertPoint } from './OsirisMap';

export interface AlertsHealth {
  last_sync_at: number | null;
  per_source?: Record<string, number>;
  active_count?: number;
}

interface Props {
  alerts: AlertPoint[]; // avis bruts (avant filtre) — sert aux compteurs
  catFilter: string[]; // catégories sélectionnées (vide = toutes)
  srcFilter: string[]; // sources sélectionnées (vide = toutes)
  onToggleCat: (c: string) => void;
  onToggleSrc: (s: string) => void;
  health: AlertsHealth | null;
  isMobile?: boolean;
}

// Taxonomie (ordre d'affichage). Slugs alignés sur le store OSIRIS + spec §12.
const CATS: { slug: string; label: string }[] = [
  { slug: 'fugue', label: 'Fugue' },
  { slug: 'disparition_inquietante', label: 'Disp. inquiétante' },
  { slug: 'enlevement_parental', label: 'Enl. parental' },
  { slug: 'disparition', label: 'Disparition' },
  { slug: 'enlevement', label: 'Enlèvement' },
  { slug: 'appel_temoins', label: 'Appel témoins' },
];
const SRCS: { slug: string; label: string }[] = [
  { slug: 'interpol_yellow', label: 'Interpol' },
  { slug: 'x116000', label: '116000' },
];

/** Badge de fraîcheur (§11) : 🟢 <20 min · 🟠 20-45 · 🔴 >45 / aucune synchro. */
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
        (on
          ? 'text-[#1a1205] bg-[#ffb23e] border-[#ffb23e]'
          : 'text-[var(--faint)] border-[var(--border-primary)] hover:text-white/80')
      }
    >
      {label} <span className="opacity-70">{count}</span>
    </button>
  );
}

function AlertsControlBar({ alerts, catFilter, srcFilter, onToggleCat, onToggleSrc, health, isMobile }: Props) {
  const { catCounts, srcCounts, total } = useMemo(() => {
    const cc: Record<string, number> = {};
    const sc: Record<string, number> = {};
    for (const a of alerts) {
      const c = a.categorie || 'disparition';
      cc[c] = (cc[c] || 0) + 1;
      sc[a.source] = (sc[a.source] || 0) + 1;
    }
    return { catCounts: cc, srcCounts: sc, total: alerts.length };
  }, [alerts]);

  const fr = freshness(health?.last_sync_at ?? null);

  return (
    <div
      className="absolute z-[206] pointer-events-auto glass-panel border border-[var(--border-primary)] rounded-lg px-3 py-2"
      style={{
        top: isMobile ? '58px' : '64px',
        left: isMobile ? '12px' : '50%',
        transform: isMobile ? 'none' : 'translateX(-50%)',
        right: isMobile ? '12px' : 'auto',
        maxWidth: isMobile ? undefined : '640px',
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[#ffb23e]">🟡 Alertes ({total})</span>
        {/* Badge fraîcheur (§11) */}
        <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: fr.color }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: fr.color, display: 'inline-block' }} />
          {fr.label}
        </span>
        <span className="text-white/15">|</span>
        {/* Chips catégorie */}
        {CATS.filter((c) => (catCounts[c.slug] || 0) > 0 || catFilter.includes(c.slug)).map((c) => (
          <Chip key={c.slug} label={c.label} count={catCounts[c.slug] || 0} on={catFilter.includes(c.slug)} onClick={() => onToggleCat(c.slug)} />
        ))}
        <span className="text-white/15">|</span>
        {/* Chips source */}
        {SRCS.filter((s) => (srcCounts[s.slug] || 0) > 0 || srcFilter.includes(s.slug)).map((s) => (
          <Chip key={s.slug} label={s.label} count={srcCounts[s.slug] || 0} on={srcFilter.includes(s.slug)} onClick={() => onToggleSrc(s.slug)} />
        ))}
      </div>
    </div>
  );
}

export default memo(AlertsControlBar);
