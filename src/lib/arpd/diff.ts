// ─────────────────────────────────────────────────────────────────────────
//  DIFF pur du sync ARPD — retrait miroir avec GRÂCE 2 syncs (règle dure RGPD).
//  Séparé de sync.ts (qui fait du réseau) pour être testable HORS-LIGNE :
//  `import type` uniquement → aucun runtime aliasé → importable par le script Node.
//  Test : scripts/arpd-diff-check.mts (nouveau / retiré×2 / grâce / sanity).
// ─────────────────────────────────────────────────────────────────────────

import type { Alert } from '@/lib/alertsStore';

export const MISS_BEFORE_RETIRE = 2; // présent absent 2 syncs consécutifs → levée

export interface SeenEntry { missCount: number; premierVu: number; alert: Alert }
export interface ArpdState { lastTotal: number; updatedAt: number; seen: Record<string, SeenEntry> }

/**
 * Combine les avis présents ce sync + les avis en grâce (absents < 2 syncs).
 * @param present  avis présents (déjà mappés en Alert, géocodés)
 * @param presentCount total scrapé (pour lastTotal)
 * @param state    état précédent (seen + lastTotal)
 * @param now      horodatage (injectable pour test déterministe)
 * @returns `incoming` = ensemble ACTIF envoyé au store · `newState` à persister.
 *          Les avis absents ≥ 2 syncs ne sont PAS dans `incoming` → le store les
 *          passe en `levee` (anonymisé) = retrait miroir.
 */
export function computeDiff(present: Alert[], presentCount: number, state: ArpdState, now: number): { incoming: Alert[]; newState: ArpdState } {
  const presentIds = new Set(present.map((a) => a.id));
  const newSeen: Record<string, SeenEntry> = {};
  const incoming: Alert[] = [];

  for (const alert of present) {
    const premierVu = state.seen[alert.id]?.premierVu ?? now;
    newSeen[alert.id] = { missCount: 0, premierVu, alert };
    incoming.push(alert);
  }
  for (const [id, entry] of Object.entries(state.seen)) {
    if (presentIds.has(id)) continue;
    const missCount = entry.missCount + 1;
    if (missCount < MISS_BEFORE_RETIRE) {
      newSeen[id] = { ...entry, missCount };
      incoming.push(entry.alert); // encore actif (grâce)
    }
    // missCount >= seuil → absent de `incoming` → levée par le store.
  }
  return { incoming, newState: { lastTotal: presentCount, updatedAt: now, seen: newSeen } };
}
