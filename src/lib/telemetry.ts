// ─────────────────────────────────────────────────────────────────────────────
//  telemetry.ts — MONITORING des appels amont (serveur only, OSIRIS V4)
//
//  Demande Cissou 07/07 : « installe quelque chose qui monitore toutes les
//  requêtes pour savoir si on a bien toutes les réponses, pour débugger ».
//
//  Chaque source (adsb.lol, USGS, celestrak, GDELT, abuse.ch, OpenSky, Overpass,
//  routes /osint/*…) enregistre le résultat de son appel : ok/échec, code HTTP,
//  latence, taille/nb d'éléments. Exposé via GET /cockpit/live-feed/diag.
//  Anneau borné (dernières 200) + compteurs cumulés par source, en mémoire
//  process (Next standalone = 1 process ; remis à zéro au restart conteneur).
// ─────────────────────────────────────────────────────────────────────────────

export interface CallRecord {
  source: string;
  ok: boolean;
  status?: number;
  ms: number;
  count?: number; // nb d'éléments utiles renvoyés (avions, séismes, articles…)
  at: number;
  note?: string;
}

interface SourceCounter {
  calls: number;
  ok: number;
  fail: number;
  lastStatus?: number;
  lastMs?: number;
  lastCount?: number;
  lastAt?: number;
  lastNote?: string;
}

const MAX = 200;

// État partagé (protégé contre les doubles instances HMR/dev).
type TelemetryState = { ring: CallRecord[]; counters: Map<string, SourceCounter> };
const G = globalThis as unknown as { __osirisTelemetry?: TelemetryState };
const S: TelemetryState = G.__osirisTelemetry ?? { ring: [], counters: new Map() };
G.__osirisTelemetry = S;

/** Enregistre le résultat d'un appel amont. `now` injectable pour les tests. */
export function recordCall(rec: Omit<CallRecord, 'at'> & { at?: number }, now = Date.now()): void {
  const full: CallRecord = { ...rec, at: rec.at ?? now };
  S.ring.push(full);
  if (S.ring.length > MAX) S.ring.splice(0, S.ring.length - MAX);
  const c = S.counters.get(full.source) ?? { calls: 0, ok: 0, fail: 0 };
  c.calls += 1;
  if (full.ok) c.ok += 1;
  else c.fail += 1;
  c.lastStatus = full.status;
  c.lastMs = Math.round(full.ms);
  c.lastCount = full.count;
  c.lastAt = full.at;
  c.lastNote = full.note;
  S.counters.set(full.source, c);
}

/**
 * Chronomètre + enregistre un appel. Passe le résultat par `ok`/`status`/`count`
 * calculés par l'appelant après coup. Retourne la valeur du travail.
 */
export async function timed<T>(
  source: string,
  work: () => Promise<T>,
  meta: (result: T) => { ok: boolean; status?: number; count?: number; note?: string },
): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    const m = meta(result);
    recordCall({ source, ms: Date.now() - started, ...m });
    return result;
  } catch (e) {
    recordCall({ source, ms: Date.now() - started, ok: false, note: e instanceof Error ? e.message : 'error' });
    throw e;
  }
}

/** État courant du monitoring (compteurs par source + 40 derniers appels). */
export function telemetrySnapshot(): {
  sources: Record<string, SourceCounter>;
  recent: CallRecord[];
  totalCalls: number;
} {
  const sources: Record<string, SourceCounter> = {};
  let total = 0;
  for (const [k, v] of S.counters) {
    sources[k] = v;
    total += v.calls;
  }
  return { sources, recent: S.ring.slice(-40), totalCalls: total };
}
