'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  FilterPanel.tsx — Panneau « Filtres de couche » (OSIRIS V4 · cockpit)
//  Agent MODULE FILTRES DE COUCHE
//
//  RÔLE
//  ────
//  Panneau flottant qui ÉDITE les filtres d'attributs des couches temps réel
//  DÉJÀ affichées (cf. src/lib/layerFilters.ts). N'affiche QUE les sections des
//  couches actuellement actives (`activeLayers.live_*`). Le parent (page.tsx)
//  applique ensuite les filtres via `applyFilter(...)` avant de passer les points
//  au châssis <OsirisMap>.
//
//  CHARTE V3 (cohérence graphique, calque de OsintPanel / ResultsPanel) :
//  panneau glassmorphism `glass-panel`, libellés techniques en `IBM Plex Mono`
//  (font-mono), accent `--accent`, apparition douce depuis la droite
//  (framer-motion), bouton fermer identique, rangées `osiris-row`.
//
//  INTÉGRATION (dans src/app/page.tsx) — même schéma que les autres panneaux :
//    1) État des filtres + ouverture :
//         const [filters, setFilters] = useState<LayerFilters>(DEFAULT_FILTERS);
//         const [filterOpen, setFilterOpen] = useState(false);
//    2) Bouton (badge = activeFilterCount(filters)) dans la barre d'outils.
//    3) Montage sous <AnimatePresence> :
//         {filterOpen && (
//           <FilterPanel
//             filters={filters}
//             onChange={setFilters}
//             onClose={() => setFilterOpen(false)}
//             activeLayers={activeLayers}
//             isMobile={isMobile}
//           />
//         )}
//    4) Avant de passer les points à <OsirisMap> :
//         aircraft={applyFilter('aircraft', aircraft, filters)} …
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, SlidersHorizontal, RotateCcw, Info } from 'lucide-react';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  type LayerFilters,
  type AircraftFilter,
  type EarthquakeFilter,
  type ShipFilter,
  type GdeltFilter,
  type CyberFilter,
} from '@/lib/layerFilters';

// ── Props ─────────────────────────────────────────────────────────────────────
interface FilterPanelProps {
  /** Modèle de filtres courant (source de vérité chez le parent). */
  filters: LayerFilters;
  /** Renvoie le nouveau modèle de filtres au parent (contrôlé). */
  onChange: (next: LayerFilters) => void;
  /** Ferme le panneau (branché sur setFilterOpen(false)). */
  onClose: () => void;
  /** État des couches actives — n'affiche que les sections des couches ON. */
  activeLayers: Record<string, boolean>;
  /** Layout compact mobile (mêmes règles que les autres panneaux). */
  isMobile?: boolean;
}

// ── Correspondance couche filtrable → clé activeLayers (préfixe live_) ─────────
const LAYER_TOGGLE: Record<string, string> = {
  aircraft: 'live_aircraft',
  earthquakes: 'live_earthquakes',
  ships: 'live_ships',
  gdelt: 'live_gdelt',
  cyber: 'live_cyber',
};

// ── Sous-composants de contrôle (charte V3) ───────────────────────────────────
/**
 * Curseur « minimum » : glissé tout à gauche (= borne basse) ⇒ aucun mini
 * (valeur `undefined`). Sinon la valeur choisie devient le seuil minimal.
 */
function MinSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const current = value ?? min;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)]">{label}</span>
        <span className="text-[11px] font-mono text-[var(--accent-bright)]">
          {value === undefined ? 'aucun' : `≥ ${value}${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(n <= min ? undefined : n);
        }}
        className="w-full accent-[var(--accent)] cursor-pointer"
      />
    </div>
  );
}

/**
 * Curseur « maximum » : glissé tout à droite (= borne haute) ⇒ aucun maxi
 * (valeur `undefined`). Sinon la valeur choisie devient le seuil maximal.
 */
function MaxSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const current = value ?? max;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)]">{label}</span>
        <span className="text-[11px] font-mono text-[var(--accent-bright)]">
          {value === undefined ? 'aucun' : `≤ ${value}${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(n >= max ? undefined : n);
        }}
        className="w-full accent-[var(--accent)] cursor-pointer"
      />
    </div>
  );
}

/** Interrupteur oui/non (charte : rangée osiris-row, actif = accent). */
function Toggle({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`osiris-row ${active ? 'osiris-row-active' : ''} w-full flex items-center justify-between px-2.5 py-1.5 my-0.5 text-left`}
    >
      <span
        className={`text-[11px] font-mono uppercase tracking-wider ${active ? 'text-[var(--accent-bright)]' : 'text-white/70'}`}
      >
        {label}
      </span>
      <span
        className={`text-[9px] font-mono uppercase tracking-widest ${active ? 'text-[var(--accent-bright)]' : 'text-[var(--faint)]'}`}
      >
        {active ? 'oui' : 'non'}
      </span>
    </button>
  );
}

/** Champ texte « contient » (filtre libellé insensible à la casse). */
function TextFilter({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="py-1">
      <div className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] mb-1">{label}</div>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          onChange(v.trim() ? v : undefined);
        }}
        className="w-full bg-black/25 border border-[var(--border-primary)] rounded-md px-2.5 py-1.5 text-[12px] font-mono text-white placeholder:text-[var(--faint)] outline-none focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)] transition"
      />
    </div>
  );
}

/** En-tête de section (nom de couche + pastille accent). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-[var(--border-primary)] bg-white/[0.015] px-3 py-2.5">
      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-[var(--accent)] mb-1.5">
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

// ── Panneau principal ─────────────────────────────────────────────────────────
function FilterPanel({ filters, onChange, onClose, activeLayers, isMobile }: FilterPanelProps) {
  // Fusions immuables : chaque helper renvoie un nouveau modèle au parent.
  const setAircraft = useCallback(
    (partial: Partial<AircraftFilter>) => {
      onChange({ ...filters, aircraft: { ...filters.aircraft, ...partial } });
    },
    [filters, onChange],
  );
  const setEarthquakes = useCallback(
    (partial: Partial<EarthquakeFilter>) => {
      onChange({ ...filters, earthquakes: { ...filters.earthquakes, ...partial } });
    },
    [filters, onChange],
  );
  const setShips = useCallback(
    (partial: Partial<ShipFilter>) => {
      onChange({ ...filters, ships: { ...filters.ships, ...partial } });
    },
    [filters, onChange],
  );
  const setGdelt = useCallback(
    (partial: Partial<GdeltFilter>) => {
      onChange({ ...filters, gdelt: { ...filters.gdelt, ...partial } });
    },
    [filters, onChange],
  );
  const setCyber = useCallback(
    (partial: Partial<CyberFilter>) => {
      onChange({ ...filters, cyber: { ...filters.cyber, ...partial } });
    },
    [filters, onChange],
  );

  const reset = useCallback(() => onChange(DEFAULT_FILTERS), [onChange]);

  // Couches filtrables actuellement actives (on ne montre que celles-ci).
  const isOn = (key: string): boolean => activeLayers?.[LAYER_TOGGLE[key]] === true;
  const anyFilterable =
    isOn('aircraft') || isOn('earthquakes') || isOn('ships') || isOn('gdelt') || isOn('cyber');
  const count = activeFilterCount(filters);

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[210] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        width: isMobile ? 'auto' : '340px',
        maxHeight: isMobile ? '62vh' : 'calc(100vh - 240px)',
      }}
    >
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filtres de couche
          {count > 0 && (
            <span className="ml-1 text-[9px] font-mono text-[var(--accent-bright)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded px-1.5 py-0.5">
              {count}
            </span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Corps : sections des couches actives ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 px-3 py-3 flex flex-col gap-2.5">
        {!anyFilterable && (
          <div className="flex flex-col items-center gap-2 text-center py-6 px-4">
            <Info className="w-5 h-5 text-[var(--faint)]" />
            <p className="text-[11px] font-mono text-[var(--muted)] leading-relaxed">
              Active une couche temps réel (avions, séismes…) pour la filtrer.
            </p>
          </div>
        )}

        {/* AVIONS */}
        {isOn('aircraft') && (
          <Section title="Avions">
            <MinSlider
              label="Altitude mini"
              unit=" ft"
              min={0}
              max={45000}
              step={500}
              value={filters.aircraft?.altMin}
              onChange={(v) => setAircraft({ altMin: v })}
            />
            <MaxSlider
              label="Altitude maxi"
              unit=" ft"
              min={0}
              max={45000}
              step={500}
              value={filters.aircraft?.altMax}
              onChange={(v) => setAircraft({ altMax: v })}
            />
            <MinSlider
              label="Vitesse mini"
              unit=" kt"
              min={0}
              max={1000}
              step={10}
              value={filters.aircraft?.speedMin}
              onChange={(v) => setAircraft({ speedMin: v })}
            />
            <MaxSlider
              label="Vitesse maxi"
              unit=" kt"
              min={0}
              max={1000}
              step={10}
              value={filters.aircraft?.speedMax}
              onChange={(v) => setAircraft({ speedMax: v })}
            />
            <Toggle
              label="Militaires uniquement"
              active={filters.aircraft?.militaryOnly === true}
              onToggle={() => setAircraft({ militaryOnly: !filters.aircraft?.militaryOnly })}
            />
            <Toggle
              label="VIP uniquement"
              active={filters.aircraft?.vipOnly === true}
              onToggle={() => setAircraft({ vipOnly: !filters.aircraft?.vipOnly })}
            />
          </Section>
        )}

        {/* SÉISMES */}
        {isOn('earthquakes') && (
          <Section title="Séismes">
            <MinSlider
              label="Magnitude mini"
              unit=""
              min={0}
              max={9}
              step={0.1}
              value={filters.earthquakes?.magMin}
              onChange={(v) => setEarthquakes({ magMin: v })}
            />
          </Section>
        )}

        {/* NAVIRES */}
        {isOn('ships') && (
          <Section title="Navires">
            <MinSlider
              label="Vitesse mini"
              unit=" nds"
              min={0}
              max={40}
              step={1}
              value={filters.ships?.speedMin}
              onChange={(v) => setShips({ speedMin: v })}
            />
            <MaxSlider
              label="Vitesse maxi"
              unit=" nds"
              min={0}
              max={40}
              step={1}
              value={filters.ships?.speedMax}
              onChange={(v) => setShips({ speedMax: v })}
            />
            <TextFilter
              label="Type de navire (contient)"
              placeholder="ex : cargo, tanker…"
              value={filters.ships?.type}
              onChange={(v) => setShips({ type: v })}
            />
          </Section>
        )}

        {/* GDELT */}
        {isOn('gdelt') && (
          <Section title="Géopolitique (GDELT)">
            <MinSlider
              label="Tonalité mini"
              unit=""
              min={-15}
              max={15}
              step={1}
              value={filters.gdelt?.toneMin}
              onChange={(v) => setGdelt({ toneMin: v })}
            />
            <MaxSlider
              label="Tonalité maxi"
              unit=""
              min={-15}
              max={15}
              step={1}
              value={filters.gdelt?.toneMax}
              onChange={(v) => setGdelt({ toneMax: v })}
            />
          </Section>
        )}

        {/* CYBER */}
        {isOn('cyber') && (
          <Section title="Cyber (serveurs C2)">
            <TextFilter
              label="Malware (contient)"
              placeholder="ex : emotet, qakbot…"
              value={filters.cyber?.malware}
              onChange={(v) => setCyber({ malware: v })}
            />
            <TextFilter
              label="Pays (contient)"
              placeholder="ex : RU, US…"
              value={filters.cyber?.country}
              onChange={(v) => setCyber({ country: v })}
            />
          </Section>
        )}
      </div>

      {/* ── Pied : réinitialiser ── */}
      <div className="px-3 py-2 border-t border-[var(--border-primary)] flex items-center justify-between">
        <span className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)]">
          Filtre la couche affichée · non destructif
        </span>
        <button
          type="button"
          onClick={reset}
          disabled={count === 0}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--accent-bright)] border border-[var(--accent-line)] bg-[var(--accent-soft)] hover:brightness-125 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          <RotateCcw className="w-3 h-3" />
          Réinitialiser
        </button>
      </div>
    </motion.div>
  );
}

export default memo(FilterPanel);
