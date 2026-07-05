'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  EntityCard.tsx — Carte-fiche riche d'une entité carte (OSIRIS V4 · cockpit)
//  Agent FICHES · V4.001
//
//  RÔLE
//  ────
//  Panneau détaillé affiché au clic sur un AVION (ou un VIP) de la carte : photo
//  de l'appareil (planespotters, publique/gratuite), identité, grille de détails
//  FR (altitude, vitesse, cap, hex, catégorie ADS-B), liens sociaux VIP, et un
//  bouton « Centrer » qui recentre la carte sur l'entité.
//
//  CHARTE V3 (cohérence graphique, IDENTIQUE à <RegionDossierPanel>/<ResultsPanel>) :
//    · panneau glassmorphism `glass-panel` + `styled-scrollbar` ;
//    · libellés techniques en IBM Plex Mono (var(--font-hud)), accent var(--accent) ;
//    · apparition douce depuis la droite (framer-motion), même gabarit de position.
//
//  DONNÉES : 100 % publiques (adsb.lol pour la position, planespotters pour la
//  photo). Usage défensif / ARPD. Clean-room (aucune copie de projet tiers).
//
//  CSP : la vignette planespotters est chargée via un <img> classique (pas
//  next/image → pas de contrainte images.remotePatterns). La CSP actuelle
//  (`img-src ... https:`) l'autorise déjà. Voir la note dans entityEnrich.ts.
//
//  ─── INTÉGRATION (dans src/app/page.tsx) ────────────────────────────────────
//    import EntityCard from '@/components/EntityCard';
//    import { enrichAircraft, type AircraftEnriched } from '@/lib/entityEnrich';
//
//    const [selectedEntity, setSelectedEntity] = useState<AircraftEnriched | null>(null);
//
//    // Au clic sur un avion (depuis OsirisMap → onEntityClick, ou un handler dédié) :
//    const handleAircraftClick = useCallback(async (a: AircraftPoint) => {
//      // Affichage immédiat sans photo, puis enrichissement asynchrone :
//      setSelectedEntity({ ...a, photo: null, socials: [] } as AircraftEnriched);
//      const enriched = await enrichAircraft(a);
//      setSelectedEntity(enriched);
//    }, []);
//
//    // …dans le JSX, à côté de <ResultsPanel> / <RegionDossierPanel> :
//    <AnimatePresence>
//      {selectedEntity && (
//        <EntityCard
//          entity={selectedEntity}
//          onClose={() => setSelectedEntity(null)}
//          onFlyTo={(loc) => setFlyTo({ ...loc, ts: Date.now() })}
//        />
//      )}
//    </AnimatePresence>
//  ─────────────────────────────────────────────────────────────────────────────

import { memo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Plane, Crosshair, Loader2, ImageOff, ExternalLink, Camera } from 'lucide-react';
import type { AircraftEnriched } from '@/lib/entityEnrich';

interface EntityCardProps {
  /** Entité enrichie à afficher (avion ± VIP + photo). */
  entity: AircraftEnriched;
  /** Ferme la fiche. */
  onClose: () => void;
  /** Recentre la carte sur l'entité (fly-to). */
  onFlyTo: (loc: { lat: number; lng: number; label: string }) => void;
  isMobile?: boolean;
}

// ── Ligne label → valeur (mono à gauche, valeur claire à droite) — cf. RegionDossierPanel ──
function Ligne({ label, value }: { label: string; value?: string }) {
  if (!value) return null; // champ absent → ligne masquée (dégradation douce)
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--faint)] flex-shrink-0">
        {label}
      </span>
      <span className="text-[12px] font-mono text-white/90 text-right break-words tabular-nums">
        {value}
      </span>
    </div>
  );
}

// ── Formatage FR d'un nombre entier (séparateur de milliers). ──
function nombreFr(n?: number): string | undefined {
  if (typeof n !== 'number' || Number.isNaN(n)) return undefined;
  return Math.round(n).toLocaleString('fr-FR');
}

// ── Zone image en tête de fiche : spinner → photo → repli « pas de photo » ──
function PhotoHeader({ entity }: { entity: AircraftEnriched }) {
  const photo = entity.photo;
  // État de chargement de l'<img> (distinct de la résolution de l'URL).
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  // Reset quand la photo change (nouvelle entité sélectionnée).
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [photo?.thumbUrl]);

  const hasPhoto = !!photo && !imgError;

  return (
    <div className="relative w-full h-[168px] bg-[var(--accent-soft)] overflow-hidden flex items-center justify-center">
      {hasPhoto ? (
        <>
          {/* Spinner tant que la vignette n'est pas peinte. */}
          {!imgLoaded && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-[11px] font-mono text-[var(--muted)]">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
              Chargement photo…
            </div>
          )}
          {/* Vignette planespotters (img classique → pas de contrainte next/image). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo!.thumbUrl}
            alt={entity.callsign || entity.hex || 'Aéronef'}
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              imgLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
          {/* Crédit photographe discret (attribution planespotters obligatoire). */}
          {imgLoaded && (
            <a
              href={photo!.link}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-1.5 right-2 flex items-center gap-1 text-[8px] font-mono text-white/70 hover:text-white bg-black/45 backdrop-blur-sm rounded px-1.5 py-0.5 transition-colors"
              title="Voir la photo sur planespotters.net"
            >
              <Camera className="w-2.5 h-2.5" />
              {photo!.photographer}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </>
      ) : (
        // Repli stylé « pas de photo » (aucune photo trouvée ou erreur de chargement).
        <div className="flex flex-col items-center gap-1.5 text-[var(--faint)]">
          <div className="relative">
            <Plane className="w-8 h-8 text-[var(--accent)]/40" />
            <ImageOff className="w-3.5 h-3.5 absolute -bottom-1 -right-1.5 text-[var(--faint)]" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest">Pas de photo</span>
        </div>
      )}
    </div>
  );
}

function EntityCard({ entity, onClose, onFlyTo, isMobile }: EntityCardProps) {
  // Titre : nom VIP prioritaire, sinon callsign, sinon hex, sinon générique.
  const titre = entity.vipName || entity.callsign || entity.hex || 'Aéronef';
  const vipColor = entity.vipColor || '#9a8cef';

  // Formatage FR des mesures (dégradation douce si champ absent).
  const altFmt = typeof entity.alt === 'number' ? `${nombreFr(entity.alt)} ft` : undefined;
  const spdFmt = typeof entity.speed === 'number' ? `${nombreFr(entity.speed)} nds` : undefined;
  const hdgFmt = typeof entity.heading === 'number' ? `${Math.round(entity.heading)}°` : undefined;

  return (
    <motion.div
      // Apparition douce depuis la droite (charte V3, cf. RegionDossierPanel).
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[207] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col overflow-hidden styled-scrollbar"
      style={{
        top: isMobile ? 'auto' : '112px',
        bottom: isMobile ? '90px' : '120px',
        right: isMobile ? '12px' : '16px',
        left: isMobile ? '12px' : 'auto',
        width: isMobile ? 'auto' : '340px',
        maxHeight: isMobile ? '58vh' : 'calc(100vh - 240px)',
      }}
    >
      {/* ── En-tête (barre titre + fermer) ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] flex-shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          Fiche entité
        </span>
        <button
          onClick={onClose}
          className="text-white/40 hover:text-white transition-colors"
          title="Fermer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Corps défilant ── */}
      <div className="overflow-y-auto styled-scrollbar flex-1 flex flex-col">
        {/* Image en tête (photo appareil ou repli stylé). */}
        <PhotoHeader entity={entity} />

        <div className="px-3 py-3 flex flex-col gap-4">
          {/* ── Titre + badges ── */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Plane className="w-4 h-4 flex-shrink-0 text-[var(--accent-bright)]" />
              <span className="text-[15px] font-mono font-semibold text-white break-words">
                {titre}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Badge VIP coloré (vipColor) si l'entité est marquée VIP. */}
              {entity.vip && (
                <span
                  className="text-[9px] font-mono uppercase tracking-widest rounded-md px-2 py-0.5 border"
                  style={{
                    color: vipColor,
                    borderColor: vipColor,
                    backgroundColor: `${vipColor}1f`, // ~12 % d'opacité (suffixe hex 1f)
                  }}
                >
                  VIP{entity.vipCategory ? ` · ${entity.vipCategory}` : ''}
                </span>
              )}
              {/* Catégorie ADS-B (si distincte / disponible). */}
              {entity.category && (
                <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-md px-2 py-0.5">
                  {entity.category}
                </span>
              )}
            </div>
          </div>

          {/* ── Grille de détails FR ── */}
          <section>
            <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--accent-bright)] pb-1 mb-1 border-b border-white/10">
              Détails de vol
            </div>
            <Ligne label="Altitude" value={altFmt} />
            <Ligne label="Vitesse sol" value={spdFmt} />
            <Ligne label="Cap" value={hdgFmt} />
            <Ligne label="Hex ICAO" value={entity.hex?.toUpperCase()} />
            <Ligne label="Catégorie" value={entity.category} />
            <Ligne label="Indicatif" value={entity.callsign} />
            {/* Aucune donnée exploitable → mention explicite. */}
            {!altFmt && !spdFmt && !hdgFmt && !entity.hex && !entity.category && !entity.callsign && (
              <div className="text-[10px] font-mono text-[var(--faint)] py-0.5">
                Aucune donnée de vol.
              </div>
            )}
          </section>

          {/* ── Socials VIP (si VIP + liens connus) ── */}
          {entity.vip && entity.socials.length > 0 && (
            <section>
              <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-[var(--accent-bright)] pb-1 mb-1 border-b border-white/10">
                Liens publics
              </div>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {entity.socials.map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-mono text-[var(--accent)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-md px-2 py-1 hover:bg-white/5 hover:border-[var(--accent-bright)] transition-colors"
                  >
                    {s.label}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* ── Action : Centrer (fly-to) ── */}
          <button
            onClick={() => onFlyTo({ lat: entity.lat, lng: entity.lng, label: titre })}
            className="osiris-btn-primary flex items-center justify-center gap-2 w-full text-[12px] font-mono py-2 rounded-lg"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Centrer
          </button>

          {/* ── Pied : sources publiques ── */}
          <div className="pt-1 border-t border-white/5">
            <div className="text-[8px] font-mono uppercase tracking-widest text-[var(--faint)]">
              Sources publiques : adsb.lol · planespotters.net
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default memo(EntityCard);
