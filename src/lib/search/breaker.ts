// ─────────────────────────────────────────────────────────────────────────
//  Circuit-breaker par connecteur — réutilise le pattern V4.078 (celestrak) :
//  après N échecs consécutifs, on OUVRE le circuit pendant un cooldown → on
//  arrête de marteler une source morte (ex. API bloquée depuis l'IP VPS). Après
//  le cooldown : half-open (une tentative ; succès → refermé, échec → ré-ouvert).
//  Protège les quotas et la latence sans faire tomber les autres sources.
// ─────────────────────────────────────────────────────────────────────────

const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 60_000; // 60 s ouvert après seuil atteint

type State = { fails: number; openedAt: number };
const circuits = new Map<string, State>();

/** true si le circuit du connecteur est OUVERT (on saute l'appel amont). */
export function breakerOpen(name: string): boolean {
  const c = circuits.get(name);
  if (!c || c.openedAt === 0) return false;
  if (Date.now() - c.openedAt >= COOLDOWN_MS) {
    // Cooldown écoulé → half-open : on laisse UNE tentative passer.
    c.openedAt = 0;
    return false;
  }
  return true;
}

export function breakerSuccess(name: string): void {
  circuits.set(name, { fails: 0, openedAt: 0 });
}

export function breakerFailure(name: string): void {
  const c = circuits.get(name) ?? { fails: 0, openedAt: 0 };
  c.fails += 1;
  if (c.fails >= FAIL_THRESHOLD && c.openedAt === 0) c.openedAt = Date.now();
  circuits.set(name, c);
}
