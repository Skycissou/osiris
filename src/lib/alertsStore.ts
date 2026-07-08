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

/** Taxonomie contrôlée des catégories (spec §12, v1.1). Extensible Lot 3. */
export const ALERT_CATEGORIES = [
  'fugue',
  'disparition_inquietante',
  'enlevement_parental',
  'disparition',
  'enlevement',
  'appel_temoins',
] as const;
export type AlertCategorie = (typeof ALERT_CATEGORIES)[number];
const CAT_SET: ReadonlySet<string> = new Set(ALERT_CATEGORIES);

/** Normalise une catégorie reçue : valeur connue conservée, sinon `disparition`
 *  (tolérance aux valeurs inconnues, spec §12 — pas de rejet). */
export function normalizeCategorie(v: unknown): AlertCategorie {
  return typeof v === 'string' && CAT_SET.has(v) ? (v as AlertCategorie) : 'disparition';
}

/** Un avis normalisé (schéma spec §4 + §12). */
export interface Alert {
  id: string; // `${source}:${source_id}` (stable, dédup)
  source: AlertSource;
  source_id: string;
  categorie: AlertCategorie; // taxonomie contrôlée (défaut `disparition`)
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

function dir(): string {
  return process.env.OSIRIS_ALERTS_DIR || path.join(process.cwd(), 'data');
}
function file(): string {
  return path.join(dir(), 'alerts.json');
}
/** Fichier séparé : horodatage de dernière synchro PAR SOURCE (monitoring §11). */
function syncFile(): string {
  return path.join(dir(), 'alerts-sync.json');
}

// Cache mémoire (protégé HMR/dev) + purge périodique idempotente.
const G = globalThis as unknown as {
  __osirisAlerts?: Map<string, Alert> | null;
  __osirisAlertsMtime?: number; // mtime du fichier au dernier chargement (anti-figé cross-process)
  __osirisAlertsPurge?: ReturnType<typeof setInterval>;
  __osirisAlertsSync?: Record<string, number> | null;
};
if (G.__osirisAlerts === undefined) G.__osirisAlerts = null;
if (G.__osirisAlertsSync === undefined) G.__osirisAlertsSync = null;

async function ensureLoaded(): Promise<Map<string, Alert>> {
  // ⚠️ Anti-« figé à la 1ère insertion » (leçon 08/07) : le cache mémoire est
  // RECHARGÉ dès que le fichier a une mtime plus récente que le dernier
  // chargement. Sinon, avec >1 worker/instance, l'ingest écrit sur le worker A
  // (mémoire + disque) mais le GET tombe sur le worker B qui resservirait
  // éternellement son snapshot de démarrage → categorie/photo/fetched_at gelés.
  try {
    const st = await fs.stat(file()).catch(() => null);
    const mtime = st ? st.mtimeMs : 0;
    if (G.__osirisAlerts && mtime === (G.__osirisAlertsMtime ?? -1)) return G.__osirisAlerts;
    const map = new Map<string, Alert>();
    const raw = mtime ? await fs.readFile(file(), 'utf8').catch(() => '') : '';
    if (raw) {
      const arr = JSON.parse(raw) as Alert[];
      if (Array.isArray(arr)) for (const a of arr) if (a && typeof a.id === 'string') map.set(a.id, a);
    }
    G.__osirisAlerts = map;
    G.__osirisAlertsMtime = mtime;
    ensurePurge();
    return map;
  } catch {
    // fichier corrompu / stat KO → garde le cache s'il existe, sinon repart vide
    if (G.__osirisAlerts) return G.__osirisAlerts;
    const map = new Map<string, Alert>();
    G.__osirisAlerts = map;
    ensurePurge();
    return map;
  }
}

async function persist(map: Map<string, Alert>): Promise<void> {
  try {
    const dir = path.dirname(file());
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file(), JSON.stringify([...map.values()]), { encoding: 'utf8', mode: 0o600 });
    // Mémorise la mtime post-écriture : ce process ne se rechargera pas pour rien
    // (les AUTRES process verront une mtime plus récente et rechargeront, eux).
    const st = await fs.stat(file()).catch(() => null);
    if (st) G.__osirisAlertsMtime = st.mtimeMs;
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
    categorie: a.categorie, // non nominatif → conservé (utile au filtre)
    statut: 'levee',
    fetched_at: a.fetched_at,
    levee_at: a.levee_at ?? Date.now(),
    // On ne garde QUE la position (pin transitoire « avis levé ici »), rien de nominatif.
    ...(typeof a.lat === 'number' ? { lat: a.lat } : {}),
    ...(typeof a.lon === 'number' ? { lon: a.lon } : {}),
    nom_affiche: '(avis levé)',
  };
}

// ── Suivi de synchro par source (monitoring §11) ────────────────────────────
async function ensureSyncLoaded(): Promise<Record<string, number>> {
  if (G.__osirisAlertsSync) return G.__osirisAlertsSync;
  const s: Record<string, number> = {};
  try {
    const raw = await fs.readFile(syncFile(), 'utf8').catch(() => '');
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>;
      for (const src of ALERT_SOURCES) if (typeof o[src] === 'number') s[src] = o[src] as number;
    }
  } catch {
    /* best-effort */
  }
  G.__osirisAlertsSync = s;
  return s;
}

/** Marque une synchro réussie d'une source (appelé à chaque ingest, même vide). */
async function recordSync(source: AlertSource): Promise<void> {
  const s = await ensureSyncLoaded();
  s[source] = Date.now();
  try {
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(syncFile(), JSON.stringify(s), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.warn('[OSIRIS alerts] sync KO:', e instanceof Error ? e.message : e);
  }
}

export interface AlertsHealth {
  last_sync_at: number | null; // synchro la plus récente toutes sources
  per_source: Record<string, number>; // ts par source
  active_count: number; // avis actifs
}

/** Santé du module (monitoring §11) : dernière synchro + nb d'avis actifs. */
export async function getHealth(): Promise<AlertsHealth> {
  const s = await ensureSyncLoaded();
  const map = await ensureLoaded();
  const times = Object.values(s).filter((n) => typeof n === 'number');
  const active_count = [...map.values()].filter((a) => a.statut === 'active').length;
  return { last_sync_at: times.length ? Math.max(...times) : null, per_source: { ...s }, active_count };
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

  // GARDE-FOU (leçon 08/07) : un lot VIDE ne doit JAMAIS déclencher la
  // réconciliation — sinon un scrape en échec (réseau, parser cassé, source
  // amont down) « lève » d'un coup TOUS les avis actifs et vide la carte.
  // On enregistre quand même la synchro (le monitoring §11 voit que le tour a
  // tourné) mais on laisse les avis existants intacts. Pour lever réellement
  // tous les avis d'une source, passer par une purge explicite, jamais par [].
  if (incoming.length === 0) {
    await recordSync(source);
    const active = [...map.values()].filter((a) => a.statut === 'active').length;
    return { active, upserted: 0, levees: 0 };
  }

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
  await recordSync(source); // monitoring §11 : synchro réussie, même lot vide
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
