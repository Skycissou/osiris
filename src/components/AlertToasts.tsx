'use client';

// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — AlertToasts : pile de toasts d'alerte (haut-droite)
//  ---------------------------------------------------------------------------
//  RÔLE
//    Rend visuellement la pile d'alertes produite par useAlertToasts()
//    (voir src/lib/alerts.ts). Purement PRÉSENTATIONNEL : ce composant ne
//    surveille rien, il reçoit `alerts` et remonte les interactions.
//
//  STYLE — charte V3 (glassmorphism) :
//    fond rgba(13,18,27,0.92) · texte #eaeff6/#c2cbd8/#7f8da1 · accent #54bdde ·
//    barre latérale colorée selon la sévérité (severityColor) · police
//    'IBM Plex Mono' pour les libellés techniques. Réutilise .glass-panel.
//
//  INTERACTIONS
//    • Clic sur le corps d'un toast géolocalisé → onFlyTo({lat,lng}).
//    • Clic sur le bouton « X » → onDismiss(id) (ne déclenche pas le fly-to).
//    • Chaque toast entre/sort en douceur (framer-motion AnimatePresence).
//
//  LIMITE D'AFFICHAGE
//    Au plus MAX_VISIBLE (4) toasts sont rendus — les PLUS RÉCENTS (le hook
//    renvoie déjà la pile récent-d'abord). Les alertes plus anciennes restent
//    dans l'état mais ne sont pas affichées (elles expireront d'elles-mêmes).
//
//  ── Intégration dans page.tsx ─────────────────────────────────────────────
//    import AlertToasts from '@/components/AlertToasts';
//    import { useAlertToasts } from '@/lib/alerts';
//    // dans le composant :
//    const { alerts, dismiss } = useAlertToasts();      // surveille le store
//    // dans le JSX (au-dessus des autres panneaux) :
//    <AlertToasts
//      alerts={alerts}
//      onDismiss={dismiss}
//      onFlyTo={({ lat, lng }) => setFlyToLocation({ lat, lng, ts: Date.now() })}
//    />
//  Dépendances : framer-motion + lucide-react + react uniquement (aucune autre).
// ─────────────────────────────────────────────────────────────────────────

import { memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Plane, Info, X, type LucideIcon } from 'lucide-react';
import { severityColor, type AlertItem, type AlertSeverity } from '@/lib/alerts';

/** Nombre max de toasts affichés simultanément (les plus récents). */
const MAX_VISIBLE = 4;

interface AlertToastsProps {
  /** Pile d'alertes (récent d'abord), fournie par useAlertToasts(). */
  alerts: AlertItem[];
  /** Retrait d'une alerte (bouton « fermer »). */
  onDismiss: (id: string) => void;
  /** Recentrage carte au clic sur un toast géolocalisé (lat/lng présents). */
  onFlyTo?: (loc: { lat: number; lng: number }) => void;
}

/**
 * Icône lucide selon la sévérité / nature de l'alerte.
 * VIP (info + coords avion) et info générique partagent 'info' par défaut ;
 * on distingue l'avion via le préfixe d'id posé par le hook ('vip:').
 */
function iconFor(alert: AlertItem): LucideIcon {
  if (alert.id.startsWith('vip:')) return Plane;
  switch (alert.severity) {
    case 'critique':
    case 'eleve':
      return AlertTriangle;
    case 'ok':
    case 'info':
    default:
      return Info;
  }
}

/** Libellé FR court de la sévérité (badge accessible / title). */
function severityLabel(severity: AlertSeverity): string {
  switch (severity) {
    case 'critique':
      return 'Critique';
    case 'eleve':
      return 'Élevé';
    case 'ok':
      return 'OK';
    case 'info':
    default:
      return 'Info';
  }
}

function AlertToasts({ alerts, onDismiss, onFlyTo }: AlertToastsProps) {
  // On n'affiche que les plus récents ; le reste expirera seul.
  const visible = alerts.slice(0, MAX_VISIBLE);

  return (
    // Conteneur en haut-droite. pointer-events-none pour laisser passer les
    // clics carte HORS des toasts ; chaque toast ré-active pointer-events.
    <div
      className="fixed top-4 right-4 z-[300] flex flex-col gap-2 pointer-events-none w-[300px] max-w-[calc(100vw-32px)]"
      aria-live="polite"
      aria-label="Alertes temps réel"
    >
      <AnimatePresence initial={false}>
        {visible.map((alert) => {
          const color = severityColor(alert.severity);
          const Icon = iconFor(alert);
          const clickable = alert.lat !== undefined && alert.lng !== undefined && !!onFlyTo;

          return (
            <motion.div
              key={alert.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="glass-panel pointer-events-auto relative flex items-stretch overflow-hidden rounded-lg shadow-lg"
              style={{ background: 'rgba(13,18,27,0.92)' }}
            >
              {/* Barre latérale colorée = sévérité (charte V3). */}
              <span
                aria-hidden
                className="w-1 flex-shrink-0"
                style={{ backgroundColor: color }}
              />

              {/* Corps cliquable (fly-to) — bouton pour l'accessibilité clavier. */}
              <button
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (clickable && onFlyTo) onFlyTo({ lat: alert.lat!, lng: alert.lng! });
                }}
                title={
                  clickable
                    ? 'Cliquer pour centrer la carte sur l’événement'
                    : severityLabel(alert.severity)
                }
                className={`flex flex-1 items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  clickable ? 'cursor-pointer hover:bg-white/5' : 'cursor-default'
                }`}
              >
                <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color }} />
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[12px] font-medium leading-snug"
                    style={{ color: '#eaeff6', fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    {alert.title}
                  </span>
                  {alert.detail && (
                    <span
                      className="mt-0.5 block truncate text-[10px] leading-snug"
                      style={{ color: '#7f8da1', fontFamily: "'IBM Plex Mono', monospace" }}
                    >
                      {alert.detail}
                    </span>
                  )}
                </span>
              </button>

              {/* Bouton fermer — stopPropagation implicite (élément séparé du corps). */}
              <button
                type="button"
                onClick={() => onDismiss(alert.id)}
                title="Fermer l’alerte"
                aria-label="Fermer l’alerte"
                className="flex-shrink-0 px-2 text-[#7f8da1] transition-colors hover:text-[#eaeff6]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default memo(AlertToasts);
