'use client';

import { memo, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { track } from '@/lib/uiTelemetry';

// ─────────────────────────────────────────────────────────────────────────
//  SearchBar — cockpit SEARCH-first (OSIRIS V4 LEAN).
//  L'utilisateur cherche une cible → onSubmit(q) déclenche l'appel backend
//  côté parent (page.tsx). Ce composant ne gère QUE la saisie + l'affichage
//  loading/erreur (état piloté par les props).
// ─────────────────────────────────────────────────────────────────────────

interface SearchBarProps {
  onSubmit: (query: string) => void;
  loading?: boolean;
  error?: string | null;
  resultCount?: number | null;
  isMobile?: boolean;
  /** Largeur de la sidebar (navW) — la barre se décale pour ne JAMAIS la chevaucher. */
  leftOffset?: number;
}

function SearchBar({ onSubmit, loading, error, resultCount, isMobile, leftOffset }: SearchBarProps) {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q && !loading) {
      track('search', { q, kind: 'target' });
      onSubmit(q);
    }
  };

  return (
    <div
      className="absolute top-16 z-[210] pointer-events-none flex flex-col gap-1.5"
      style={{ left: isMobile ? '16px' : `${Math.max((leftOffset ?? 0) + 24, 100)}px`, right: '16px', maxWidth: isMobile ? undefined : '520px' }}
    >
      <form
        onSubmit={submit}
        /* osiris-search = anneau de focus accent repris de .searchbar:focus-within (landing) */
        className="osiris-search pointer-events-auto flex items-center gap-2 glass-panel px-3 py-2 border border-[var(--border-primary)]"
      >
        <Search className="w-4 h-4 flex-shrink-0 text-[var(--accent)]" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Rechercher une cible (nom, SIREN, adresse, code postal…)"
          className="flex-1 bg-transparent outline-none text-sm font-mono text-white placeholder:text-white/30"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={loading}
          /* Pill accent arrondie (rounded-full + accent-soft/line) — style .chip.active de la landing */
          className="hover-lift flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--accent-soft)] hover:bg-[var(--accent)]/25 border border-[var(--accent-line)] hover:border-[var(--accent)]/50 text-[10px] font-mono uppercase tracking-widest text-[var(--accent-bright)] transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {loading ? 'Recherche' : 'Chercher'}
        </button>
      </form>

      {error && (
        <div className="pointer-events-auto text-[11px] font-mono text-[var(--red,#db6f78)] glass-panel px-3 py-1.5">
          ⚠ {error}
        </div>
      )}
      {!error && resultCount != null && (
        <div className="pointer-events-none text-[10px] font-mono tracking-wider text-[var(--faint)] px-1">
          {resultCount === 0 ? 'Aucun point géolocalisé pour cette recherche.' : `${resultCount} point(s) géolocalisé(s) sur la carte.`}
        </div>
      )}
    </div>
  );
}

export default memo(SearchBar);
