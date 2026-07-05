'use client';

import { memo } from 'react';
import { X, MapPin } from 'lucide-react';
import { groupCardsByType, extractLatLon, type SearchResponse, type RadarCard } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────
//  ResultsPanel — liste légère des résultats groupés par type.
//  Clic sur une carte géolocalisée → fly-to (onFlyTo). Les cartes sans
//  coordonnées restent listées mais non cliquables (pas de point carte).
// ─────────────────────────────────────────────────────────────────────────

interface ResultsPanelProps {
  response: SearchResponse | null;
  onFlyTo: (loc: { lat: number; lng: number; label: string }) => void;
  onClose: () => void;
  isMobile?: boolean;
}

function firstLine(card: RadarCard): string {
  return (card.summary || '').split('\n')[0] || card.subtitle || '';
}

function ResultsPanel({ response, onFlyTo, onClose, isMobile }: ResultsPanelProps) {
  if (!response) return null;
  const groups = groupCardsByType(response);
  const total = groups.reduce((n, g) => n + g.cards.length, 0);

  return (
    <div
      className="absolute z-[205] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        width: isMobile ? 'auto' : '340px',
        maxHeight: isMobile ? '40vh' : 'calc(100vh - 240px)',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          Résultats · {total}
        </span>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" title="Fermer">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 px-2 py-2 flex flex-col gap-3">
        {groups.length === 0 && (
          <div className="text-[11px] font-mono text-[var(--faint)] px-1 py-2">Aucun résultat trouvé.</div>
        )}
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-1">
            <div
              className="text-[9px] font-mono font-bold uppercase tracking-widest px-1 pb-1 border-b border-white/5"
              style={{ color: g.color }}
            >
              {g.label} · {g.cards.length}
            </div>
            {g.cards.map((card, i) => {
              const ll = extractLatLon(card);
              const clickable = !!ll;
              return (
                <button
                  key={`${g.key}-${i}`}
                  disabled={!clickable}
                  onClick={() => ll && onFlyTo({ lat: ll[0], lng: ll[1], label: card.title })}
                  /* Survol premium repris de .result de la landing : bordure accent + léger décollement */
                  className={`text-left px-2.5 py-2 rounded-lg border border-transparent transition-all ${
                    clickable
                      ? 'hover:bg-white/5 hover:border-[var(--accent-line)] hover:-translate-y-px cursor-pointer'
                      : 'opacity-70 cursor-default'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {clickable && <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: g.color }} />}
                    <span className="text-[12px] font-mono text-white truncate">{card.title}</span>
                  </div>
                  {firstLine(card) && (
                    <div className="text-[10px] font-mono text-white/50 truncate mt-0.5">{firstLine(card)}</div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(ResultsPanel);
