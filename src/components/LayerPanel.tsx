'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Building2, Scale, Home, MapPin, Users, Sun } from 'lucide-react';

interface LayerPanelProps {
  data: Record<string, any>;
  activeLayers: Record<string, boolean>;
  setActiveLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isMobile?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
//  Groupes de couches FR — STUB (OSIRIS V4 LEAN).
//  Toutes vides pour l'instant : les données viendront du backend FastAPI FR.
//  Les clés (fr_*) sont canoniques et doivent matcher :
//   - `activeLayers` dans page.tsx
//   - les gabarits `setGeo('fr-...')` dans OsirisMap.tsx
//  TODO: câbler chaque couche quand l'endpoint backend correspondant existe.
// ─────────────────────────────────────────────────────────────────────────
const LAYER_GROUPS = [
  {
    label: 'ENTR',
    fullLabel: 'ENTREPRISES',
    color: '#54bdde',
    layers: [
      // TODO: Sirene / API Recherche d'entreprises (annuaire-entreprises.data.gouv.fr)
      { key: 'fr_entreprises', label: 'Entreprises (SIRENE)', icon: Building2, color: '#54bdde', dataKey: 'fr_entreprises' },
    ],
  },
  {
    label: 'BODA',
    fullLabel: 'BODACC',
    color: '#db6f78',
    layers: [
      // TODO: BODACC (annonces commerciales — bodacc-datadila.opendatasoft.com)
      { key: 'fr_bodacc', label: 'Annonces BODACC', icon: Scale, color: '#db6f78', dataKey: 'fr_bodacc' },
    ],
  },
  {
    label: 'DVF',
    fullLabel: 'VALEURS FONCIÈRES (DVF)',
    color: '#9bdcf0',
    layers: [
      // TODO: DVF (Demandes de Valeurs Foncières — app.dvf.etalab.gouv.fr / API)
      { key: 'fr_dvf', label: 'Mutations DVF', icon: Home, color: '#9bdcf0', dataKey: 'fr_dvf' },
    ],
  },
  {
    label: 'BAN',
    fullLabel: 'BASE ADRESSE NATIONALE',
    color: '#9a8cef',
    layers: [
      // TODO: BAN (Base Adresse Nationale — api-adresse.data.gouv.fr)
      { key: 'fr_ban', label: 'Adresses (BAN)', icon: MapPin, color: '#9a8cef', dataKey: 'fr_ban' },
    ],
  },
  {
    label: 'RNA',
    fullLabel: 'ASSOCIATIONS (RNA)',
    color: '#5bc78d',
    layers: [
      // TODO: RNA (Répertoire National des Associations — data.gouv.fr)
      { key: 'fr_rna', label: 'Associations (RNA)', icon: Users, color: '#5bc78d', dataKey: 'fr_rna' },
    ],
  },
  {
    label: 'DISP',
    fullLabel: 'AFFICHAGE',
    color: '#54bdde',
    layers: [
      { key: 'day_night', label: 'Cycle Jour / Nuit', icon: Sun, color: '#54bdde', dataKey: '' },
    ],
  },
];

function LayerPanel({ data, activeLayers, setActiveLayers, isMobile }: LayerPanelProps) {
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  const toggle = (key: string) => setActiveLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const getCount = (dk: string): number | null => {
    if (!dk) return null;
    let total = 0;
    let found = false;
    for (const k of dk.split(',')) {
      if (data[k] && Array.isArray(data[k])) {
        total += data[k].length;
        found = true;
      }
    }
    return found ? total : null;
  };

  if (isMobile) {
    return (
      <div className="flex flex-col gap-4 py-2">
        {LAYER_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-2">
            <div
              className="text-[10px] font-bold font-mono tracking-widest border-b border-white/10 pb-1"
              style={{ color: group.color }}
            >
              {group.fullLabel}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {group.layers.map((layer) => {
                const isLayerActive = activeLayers[layer.key];
                const count = getCount(layer.dataKey);
                const Icon = layer.icon;
                return (
                  <button
                    key={layer.key}
                    onClick={() => toggle(layer.key)}
                    className={`flex items-center gap-2 px-2 py-2 rounded border transition-colors ${
                      isLayerActive ? 'bg-white/10 border-white/20' : 'bg-transparent border-white/5 hover:border-white/10'
                    }`}
                  >
                    <Icon className="w-3 h-3 flex-shrink-0" style={{ color: isLayerActive ? layer.color : 'rgba(255,255,255,0.4)' }} />
                    <span className={`text-[9px] font-mono uppercase tracking-wider flex-1 text-left ${isLayerActive ? 'text-white' : 'text-white/60'}`}>
                      {layer.label}
                    </span>
                    {count !== null && (
                      <span className="text-[8px] font-mono tabular-nums opacity-60">{count.toLocaleString()}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ x: -100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="absolute top-0 left-0 h-full w-[80px] border-r border-[var(--border-primary)] flex flex-col pt-32 pb-8 z-50 pointer-events-auto bg-[var(--bg-panel)] backdrop-blur-[24px] saturate-150"
      style={{ boxShadow: '4px 0 24px rgba(0,0,0,0.5)' }}
    >
      <div className="flex-1 flex flex-col gap-8 px-2">
        {LAYER_GROUPS.map((group) => {
          const groupActiveCount = group.layers.filter((l) => activeLayers[l.key]).length;
          const isActive = groupActiveCount > 0;
          const isHovered = hoveredGroup === group.label;

          return (
            <div
              key={group.label}
              className="relative flex justify-center items-center"
              onMouseEnter={() => setHoveredGroup(group.label)}
              onMouseLeave={() => setHoveredGroup(null)}
            >
              <div
                className="text-[10px] font-mono font-bold cursor-pointer select-none transition-all duration-300 flex items-center justify-center"
                style={{
                  writingMode: 'horizontal-tb',
                  color: isActive ? group.color : 'rgba(255, 255, 255, 0.4)',
                  textShadow: isActive ? `0 0 10px ${group.color}80` : 'none',
                  letterSpacing: '0.1em',
                  opacity: isActive || isHovered ? 1 : 0.5,
                }}
              >
                {isActive && (
                  <div
                    className="absolute -left-1 w-1 h-1 rounded-full animate-pulse"
                    style={{ backgroundColor: group.color, boxShadow: `0 0 8px ${group.color}` }}
                  />
                )}
                {group.label}
              </div>

              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    initial={{ opacity: 0, x: -10, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, x: -5, filter: 'blur(2px)' }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="absolute left-[70px] top-1/2 -translate-y-1/2 min-w-[240px] bg-black/80 backdrop-blur-md border border-white/10 rounded-lg p-3 shadow-2xl z-50 pointer-events-auto"
                    style={{ boxShadow: `0 0 30px ${group.color}15, inset 0 0 20px ${group.color}05` }}
                  >
                    <div className="text-[11px] font-bold font-mono mb-3 tracking-widest border-b border-white/10 pb-2" style={{ color: group.color }}>
                      {group.fullLabel}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {group.layers.map((layer) => {
                        const isLayerActive = activeLayers[layer.key];
                        const count = getCount(layer.dataKey);
                        const Icon = layer.icon;
                        return (
                          <button
                            key={layer.key}
                            onClick={() => toggle(layer.key)}
                            className="w-full flex items-center gap-3 px-2 py-1.5 rounded bg-transparent hover:bg-white/5 transition-colors group"
                          >
                            <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: isLayerActive ? layer.color : 'rgba(255,255,255,0.4)' }} />
                            <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 text-left transition-colors duration-200 ${isLayerActive ? 'text-white' : 'text-white/50 group-hover:text-white/80'}`}>
                              {layer.label}
                            </span>
                            {count !== null && (
                              <span className="text-[9px] font-mono tabular-nums opacity-60">{count.toLocaleString()}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export default memo(LayerPanel);
