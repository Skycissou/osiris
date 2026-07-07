// ─────────────────────────────────────────────────────────────────────────────
//  uiTelemetryStore.ts — Stockage JSONL de la télémétrie UI (serveur only)
//
//  Spec Claude 07/07 (§5). 1 ligne JSONL = { sid, at, srv, t, d }. Rotation
//  quotidienne (YYYY-MM-DD.jsonl), purge > 7 jours (au boot + 1×/24 h). Écriture
//  append async, tolérante (erreur disque → console + drop, jamais de crash).
//  Aucune IP, aucun user-agent (minimisation RGPD / posture ARPD).
//
//  Chemin : env OSIRIS_UI_TELEMETRY_DIR, défaut <cwd>/data/ui-telemetry/.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Un événement stocké (enrichi du timestamp serveur `srv`). */
export interface StoredEvent {
  sid: string;
  at: number; // horloge client (ms)
  srv: number; // horloge serveur (ms) — fait foi
  t: string; // type (whitelist §3)
  d: Record<string, unknown>; // détail (déjà tronqué)
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function dir(): string {
  return process.env.OSIRIS_UI_TELEMETRY_DIR || path.join(process.cwd(), 'data', 'ui-telemetry');
}

/** Nom de fichier du jour d'un timestamp (UTC, aligné sur la rétention). */
function dayFile(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 10)}.jsonl`;
}

// Purge protégée contre les doubles instances (HMR/dev), comme telemetry.ts.
const G = globalThis as unknown as { __osirisUiTelPurge?: ReturnType<typeof setInterval> };

/** Supprime les fichiers plus vieux que la rétention. Ne throw jamais. */
async function purge(): Promise<void> {
  try {
    const base = dir();
    const files = await fs.readdir(base).catch(() => [] as string[]);
    const cutoff = Date.now() - RETENTION_MS;
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const dayMs = Date.parse(f.slice(0, 10));
      if (Number.isFinite(dayMs) && dayMs < cutoff) {
        await fs.rm(path.join(base, f)).catch(() => {});
      }
    }
  } catch {
    /* purge best-effort */
  }
}

/** Démarre la purge périodique (idempotent). Appelée à la 1ʳᵉ écriture. */
function ensurePurge(): void {
  if (G.__osirisUiTelPurge) return;
  void purge();
  G.__osirisUiTelPurge = setInterval(() => void purge(), PURGE_INTERVAL_MS);
}

/** Append d'un lot d'événements. Best-effort, ne throw jamais. */
export async function appendEvents(events: StoredEvent[]): Promise<void> {
  if (events.length === 0) return;
  ensurePurge();
  try {
    const base = dir();
    await fs.mkdir(base, { recursive: true });
    // Tous les events d'un batch atterrissent dans le fichier du jour serveur.
    const file = path.join(base, dayFile(Date.now()));
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await fs.appendFile(file, lines, 'utf8');
  } catch (e) {
    console.warn('[OSIRIS ui-telemetry] écriture KO:', e instanceof Error ? e.message : e);
  }
}

/** Lit tous les events d'un jour donné (défaut : aujourd'hui). */
async function readDay(ts: number): Promise<StoredEvent[]> {
  try {
    const file = path.join(dir(), dayFile(ts));
    const raw = await fs.readFile(file, 'utf8').catch(() => '');
    const out: StoredEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as StoredEvent);
      } catch {
        /* ligne corrompue → ignorée */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Résumé d'une session (pour la liste). */
export interface SessionSummary {
  sid: string;
  first: number;
  last: number;
  count: number;
  errors: number;
}

/** Liste les sessions du jour (agrégats, pas le détail). */
export async function listSessionsToday(): Promise<SessionSummary[]> {
  const events = await readDay(Date.now());
  const bySid = new Map<string, SessionSummary>();
  for (const e of events) {
    const s = bySid.get(e.sid) ?? { sid: e.sid, first: e.srv, last: e.srv, count: 0, errors: 0 };
    s.first = Math.min(s.first, e.srv);
    s.last = Math.max(s.last, e.srv);
    s.count += 1;
    if (e.t === 'js_error' || e.t === 'promise_reject' || (e.t === 'fetch' && e.d?.ok === false)) s.errors += 1;
    bySid.set(e.sid, s);
  }
  return [...bySid.values()].sort((a, b) => b.last - a.last);
}

/** Tous les events UI d'une session (aujourd'hui + hier, au cas où à cheval). */
export async function readSession(sid: string): Promise<StoredEvent[]> {
  const today = await readDay(Date.now());
  const yesterday = await readDay(Date.now() - 24 * 60 * 60 * 1000);
  return [...yesterday, ...today].filter((e) => e.sid === sid).sort((a, b) => a.srv - b.srv);
}
