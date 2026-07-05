'use client';

import { memo, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

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
}

function SearchBar({ onSubmit, loading, error, resultCount, isMobile }: SearchBarProps) {
  const [value, setValue] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q && !loading) onSubmit(q);
  };

  return (
    <div
      className="absolute top-16 z-[210] pointer-events-none flex flex-col gap-1.5"
      style={{ left: isMobile ? '16px' : '100px', right: '16px', maxWidth: isMobile ? undefined : '520px' }}
    >
      <form
        onSubmit={submit}
        className="pointer-events-auto flex items-center gap-2 glass-panel px-3 py-2 border border-[var(--border-primary)]"
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
          className="flex items-center gap-1.5 px-3 py-1 rounded bg-[var(--accent)]/15 hover:bg-[var(--accent)]/25 border border-[var(--accent)]/30 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] transition-colors disabled:opacity-50"
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
