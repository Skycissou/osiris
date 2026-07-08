// ─────────────────────────────────────────────────────────────────────────────
//  alertsStore.ts — Stockage des « Alertes disparitions » (serveur only)
//
//  Spec Claude chat 08/07 (`notes/ops/2026-07-08-osiris-veille-alertes-spec.md`).
//  Avis de recherche OFFICIELS de personnes disparues (Interpol Yellow, 116000).
//  Alimenté par un workflow n8n (POST /cockpit/alerts/ingest, token), lu par la
//  couche carto (Lot 2). Faible volume + purge → simple fichier JSON dans le
//  volume persistant (même pattern que serverKeyStore/uiTelemetryStore).
//
//  ⚠️ RGPD / ARPD (RÈGLES DURES, spec §6) :
//    • Photos JAMAIS copiées localement → on ne garde que l'URL (hotlink).
//    • Réconciliation à CHAQUE poll : un avis absent du dernier fetch source
//      passe `levee` immédiatement + est ANONYMISÉ (nom/photo/lieu retirés).
//    • Purge : `levee` gardé 24 h (anonymisé) puis DELETE définitif de la ligne.
//      Aucune archive nominative. Droit à l'oubli, surtout mineurs.
//
//  Chemin : env OSIRIS_ALERTS_DIR (défaut <cwd>/data). Fichier : alerts.json.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Sources d'avis autorisées (whitelist stricte). */
export const ALERT_SOURCES = ['interpol_yellow', 'x116000'] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];
const SOURCE_SET: ReadonlySet<string> = new Set(ALERT_SOURCES);

/** Un avis normalisé (schéma spec §4). */
export interface Alert {
  id: string; // `${source}:${source_id}` (stable, dédup)
  source: AlertSource;
  source_id: string;
  url_source?: string;
  nom_affiche?: string;
  age?: number;
  sexe?: string;
  date_publication?: string;
  lieu_texte?: string;
  lat?: number;
  lon?: number;
  photo_url?: string; // HOTLINK source uniquement, jamais de copie locale
  statut: 'active' | 'levee';
  fetched_at: number;
  levee_at?: number; // horodatage de passage en `levee` (base de la purge 24 h)
}

const LEVEE_TTL_MS = 24 * 60 * 60_000; // avis levé gardé 24 h (anonymisé) puis DELETE
const PURGE_INTERVAL_MS = 60 * 60_000; // purge horaire

function file(): string {
  const dir = process.env.OSIRIS_ALERTS_DIR || path.join(process.cwd(), 'data');
  return path.join(dir, 'alerts.json');
}

// Cache mémoire (protégé HMR/dev) + purge périodique idempotente.
const G = globalThis as unknown as {
  __osirisAlerts?: Map<string, Alert> | null;
  __osirisAlertsPurge?: ReturnType<typeof setInterval>;
};
if (G.__osirisAlerts === undefined) G.__osirisAlerts = null;

async function ensureLoaded(): Promise<Map<string, Alert>> {
  if (G.__osirisAlerts) return G.__osirisAlerts;
  const map = new Map<string, Alert>();
  try {
    const raw = await fs.readFile(file(), 'utf8').catch(() => '');
    if (raw) {
      const arr = JSON.parse(raw) as Alert[];
      if (Array.isArray(arr)) for (const a of arr) if (a && typeof a.id === 'string') map.set(a.id, a);
    }
  } catch {
    /* fichier corrompu → repart vide (best-effort) */
  }
  G.__osirisAlerts = map;
  ensurePurge();
  return map;
}

async function persist(map: Map<string, Alert>): Promise<void> {
  try {
    const dir = path.dirname(file());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file(), JSON.stringify([...map.values()]), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.warn('[OSIRIS alerts] écriture KO:', e instanceof Error ? e.message : e);
  }
}

/** Anonymise un avis levé : on retire TOUT ce qui est nominatif (RGPD §6). */
function anonymize(a: Alert): Alert {
  return {
    id: a.id,
    source: a.source,
    source_id: a.source_id,
    statut: 'levee',
    fetched_at: a.fetched_at,
    levee_at: a.levee_at ?? Date.now(),
    // On ne garde QUE la position (pin transitoire « avis levé ici »), rien de nominatif.
    ...(typeof a.lat === 'number' ? { lat: a.lat } : {}),
    ...(typeof a.lon === 'number' ? { lon: a.lon } : {}),
    nom_affiche: '(avis levé)',
  };
}

/** Supprime définitivement les avis `levee` de plus de 24 h. Ne throw jamais. */
async function purge(): Promise<void> {
  const map = G.__osirisAlerts;
  if (!map) return;
  const cutoff = Date.now() - LEVEE_TTL_MS;
  let changed = false;
  for (const [id, a] of map) {
    if (a.statut === 'levee' && (a.levee_at ?? 0) < cutoff) {
      map.delete(id);
      changed = true;
    }
  }
  if (changed) await persist(map);
}

function ensurePurge(): void {
  if (G.__osirisAlertsPurge) return;
  void purge();
  G.__osirisAlertsPurge = setInterval(() => void purge(), PURGE_INTERVAL_MS);
}

/** true si `s` est une source gérée. */
export function isAlertSource(s: unknown): s is AlertSource {
  return typeof s === 'string' && SOURCE_SET.has(s);
}

export interface IngestResult {
  active: number; // avis actifs après upsert (toutes sources)
  upserted: number; // avis reçus et enregistrés/mis à jour
  levees: number; // avis passés en `levee` par réconciliation ce tour
}

/**
 * Upsert du LOT COMPLET d'une source + RÉCONCILIATION (spec §6) :
 *  • chaque avis reçu est créé/mis à jour (statut active) ;
 *  • tout avis ACTIF de cette source ABSENT du lot → `levee` + anonymisé ;
 *  • purge des `levee` > 24 h.
 * `incoming` = la liste COURANTE COMPLÈTE de la source (pas un delta).
 */
export async function upsertSource(source: AlertSource, incoming: Alert[]): Promise<IngestResult> {
  const map = await ensureLoaded();
  const now = Date.now();
  const seen = new Set<string>();
  let upserted = 0;
  for (const a of incoming) {
    map.set(a.id, { ...a, source, statut: 'active', fetched_at: now, levee_at: undefined });
    seen.add(a.id);
    upserted += 1;
  }
  // Réconciliation : les avis actifs de cette source non revus → levée anonymisée.
  let levees = 0;
  for (const [id, a] of map) {
    if (a.source === source && a.statut === 'active' && !seen.has(id)) {
      map.set(id, anonymize({ ...a, levee_at: now }));
      levees += 1;
    }
  }
  await persist(map);
  await purge();
  const active = [...map.values()].filter((a) => a.statut === 'active').length;
  return { active, upserted, levees };
}

/** Avis à afficher : actifs (complets) + levés < 24 h (déjà anonymisés). */
export async function listAlerts(onlyActive = false): Promise<Alert[]> {
  const map = await ensureLoaded();
  const all = [...map.values()];
  const filtered = onlyActive ? all.filter((a) => a.statut === 'active') : all;
  return filtered.sort((a, b) => (b.date_publication || '').localeCompare(a.date_publication || ''));
}
