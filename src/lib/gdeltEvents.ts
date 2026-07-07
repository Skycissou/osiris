// ─────────────────────────────────────────────────────────────────────────────
//  gdeltEvents.ts — Couche GÉOPOLITIQUE via les FICHIERS EXPORT GDELT 2.0
//  (serveur only — consommé par /live-feed/slow)
//
//  POURQUOI (décision Cissou 07/07, « go A ») : l'API GEO interactive
//  (api.gdeltproject.org/api/v2/geo/geo) renvoie un VRAI 404 — morte/retirée.
//  La couche géopolitique n'a donc jamais rien affiché (échec silencieux
//  depuis V4.012). On bascule sur le canal FICHIERS de GDELT :
//    https://data.gdeltproject.org/gdeltv2/lastupdate.txt
//  → pointe toutes les 15 min vers un .export.CSV.zip (~1-5 Mo) contenant les
//  ÉVÉNEMENTS mondiaux géocodés (61 colonnes, doc « GDELT 2.0 Event Database »).
//  Autre hôte, pas de rate-limit interactif, gratuit, sans clé.
//
//  PIPELINE : lastupdate.txt → URL du zip → unzip (fflate) → TSV 61 colonnes
//  → filtre « points chauds » (QuadClass 3/4 = conflits verbaux/matériels, ou
//  racine CAMEO 14 = manifestations) → dédup par point (garde le + d'articles)
//  → top 300 par nb d'articles → même forme que l'ex-couche (id/lat/lng/name/
//  count/url/tone) → AUCUN changement côté carte.
//
//  CACHE 15 min (rythme de publication GDELT) + stale-on-error : fichier
//  suivant indisponible → on garde le précédent au lieu de vider la couche.
// ─────────────────────────────────────────────────────────────────────────────

import { unzipSync, strFromU8 } from 'fflate';
import { safeFetch } from '@/lib/ssrf-guard';
import { recordCall } from '@/lib/telemetry';

/** Index des fichiers 15-min GDELT (1ʳᵉ ligne = export.CSV.zip courant). */
const LASTUPDATE_URL = 'https://data.gdeltproject.org/gdeltv2/lastupdate.txt';
/** Rythme de publication GDELT = 15 min → TTL du cache aligné. */
const CACHE_TTL_MS = 15 * 60_000;
/** Timeout réseau par requête (le zip fait quelques Mo). */
const TIMEOUT_MS = 25_000;
/** Garde-fou : zip refusé au-delà de cette taille (fichier anormal). */
const MAX_ZIP_BYTES = 30 * 1024 * 1024;
/** Plafond de points renvoyés (même valeur que l'ex-couche GEO). */
const MAX_POINTS = 300;

// ── Colonnes utiles de la table « GDELT 2.0 Event Database » (61 colonnes) ──
const COL_EVENT_ID = 0; // GLOBALEVENTID (id stable)
const COL_ACTOR1_NAME = 6; // Actor1Name (qui agit)
const COL_ACTOR2_NAME = 16; // Actor2Name (cible)
const COL_ROOTCODE = 28; // EventRootCode (CAMEO racine, '14' = PROTEST)
const COL_QUADCLASS = 29; // 1 coop.verbale · 2 coop.matérielle · 3 CONFLIT verbal · 4 CONFLIT matériel
const COL_GOLDSTEIN = 30; // GoldsteinScale (-10..+10) — impact sur la stabilité
const COL_NUM_ARTICLES = 33; // intensité de couverture média
const COL_AVG_TONE = 34; // tonalité moyenne (négatif = hostile)
const COL_GEO_FULLNAME = 52; // ActionGeo_FullName (libellé du lieu)
const COL_GEO_LAT = 56; // ActionGeo_Lat
const COL_GEO_LNG = 57; // ActionGeo_Long
const COL_SOURCE_URL = 60; // SOURCEURL (article représentatif)
const MIN_COLS = 61;

/** Même forme que l'interface GdeltEvent du flux lent (contrat carte inchangé). */
export interface GdeltExportEvent {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  count?: number;
  title?: string;
  url?: string;
  tone?: number;
  goldstein?: number; // impact stabilité (-10..+10) — hiérarchiser par GRAVITÉ
  actor1?: string; // qui agit
  actor2?: string; // cible / autre partie
}

// ── Cache module (process Next standalone) ───────────────────────────────────
let cached: { ts: number; events: GdeltExportEvent[] } | null = null;
/** Sérialise les rafraîchissements concurrents (un seul téléchargement à la fois). */
let inflight: Promise<GdeltExportEvent[]> | null = null;

/** fetch + timeout, renvoie la réponse ou throw. */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'User-Agent': 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)' },
      maxRedirects: 2,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Extrait l'URL du .export.CSV.zip courant depuis lastupdate.txt.
 * Format des lignes : « <taille> <hash> <url> ». On force https (le fichier
 * liste du http:// ; data.gdeltproject.org sert les deux).
 */
function parseLastUpdate(text: string): string | null {
  for (const line of text.split('\n')) {
    const url = line.trim().split(/\s+/).pop();
    if (url && url.endsWith('.export.CSV.zip')) {
      return url.replace(/^http:\/\//, 'https://');
    }
  }
  return null;
}

/** Dézippe le premier fichier du zip (l'export n'en contient qu'un). */
function unzipFirstEntry(buf: Uint8Array): string | null {
  try {
    const entries = unzipSync(buf);
    const first = Object.values(entries)[0];
    return first ? strFromU8(first) : null;
  } catch {
    return null;
  }
}

/**
 * Parse le TSV « événements » → points géopolitiques filtrés.
 * On ne retient que les points chauds (conflits/manifestations) géocodés,
 * dédupliqués par coordonnée (on garde l'événement le plus couvert), triés
 * par couverture média décroissante, plafonnés à MAX_POINTS.
 */
function parseEventsTsv(tsv: string): GdeltExportEvent[] {
  const byPoint = new Map<string, GdeltExportEvent>();
  for (const line of tsv.split('\n')) {
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < MIN_COLS) continue;

    // Points chauds uniquement : conflit (verbal/matériel) ou manifestation.
    const quad = cols[COL_QUADCLASS];
    const root = cols[COL_ROOTCODE];
    if (quad !== '3' && quad !== '4' && root !== '14') continue;

    const lat = Number(cols[COL_GEO_LAT]);
    const lng = Number(cols[COL_GEO_LNG]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue; // non géocodé

    const count = Number(cols[COL_NUM_ARTICLES]);
    const tone = Number(cols[COL_AVG_TONE]);
    const goldstein = Number(cols[COL_GOLDSTEIN]);
    const name = (cols[COL_GEO_FULLNAME] || '').trim() || undefined;
    const url = (cols[COL_SOURCE_URL] || '').trim() || undefined;
    const eventId = (cols[COL_EVENT_ID] || '').trim();
    const actor1 = (cols[COL_ACTOR1_NAME] || '').trim() || undefined;
    const actor2 = (cols[COL_ACTOR2_NAME] || '').trim() || undefined;

    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const prev = byPoint.get(key);
    if (prev && (prev.count ?? 0) >= (Number.isFinite(count) ? count : 0)) continue;
    byPoint.set(key, {
      id: eventId || `${key}${name ? `,${name}` : ''}`, // GLOBALEVENTID stable si dispo
      lat,
      lng,
      ...(name ? { name } : {}),
      ...(Number.isFinite(count) ? { count } : {}),
      ...(url ? { url } : {}),
      ...(Number.isFinite(tone) ? { tone } : {}),
      ...(Number.isFinite(goldstein) ? { goldstein } : {}),
      ...(actor1 ? { actor1 } : {}),
      ...(actor2 ? { actor2 } : {}),
    });
  }
  return [...byPoint.values()]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, MAX_POINTS);
}

/** Téléchargement + parse complet (une passe). Throw en cas d'échec. */
async function refresh(): Promise<GdeltExportEvent[]> {
  const started = Date.now();
  try {
    const idxRes = await fetchWithTimeout(LASTUPDATE_URL);
    if (!idxRes.ok) throw new Error(`lastupdate ${idxRes.status}`);
    const zipUrl = parseLastUpdate(await idxRes.text());
    if (!zipUrl) throw new Error('lastupdate sans export.CSV.zip');

    const zipRes = await fetchWithTimeout(zipUrl);
    if (!zipRes.ok) throw new Error(`zip ${zipRes.status}`);
    const raw = new Uint8Array(await zipRes.arrayBuffer());
    if (raw.byteLength > MAX_ZIP_BYTES) throw new Error(`zip trop gros (${raw.byteLength}o)`);

    const tsv = unzipFirstEntry(raw);
    if (!tsv) throw new Error('zip illisible');
    const events = parseEventsTsv(tsv);
    recordCall({ source: 'gdelt-export', ok: true, status: 200, ms: Date.now() - started, count: events.length, note: 'export 15min' });
    return events;
  } catch (e) {
    // Visibilité diag : savoir si data.gdeltproject.org est bloqué depuis le VPS
    // (même infra que api.gdeltproject.org, déjà bloquée). Puis on relance l'erreur.
    recordCall({ source: 'gdelt-export', ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
    throw e;
  }
}

/**
 * Point d'entrée : événements géopolitiques courants.
 *  • cache frais (< 15 min) → mémoire, zéro réseau ;
 *  • sinon re-télécharge (un seul téléchargement concurrent) ;
 *  • échec → on sert le cache PÉRIMÉ s'il existe (stale-on-error), sinon [].
 */
export async function getGdeltEvents(): Promise<GdeltExportEvent[]> {
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.events;
  if (!inflight) {
    inflight = refresh()
      .then((events) => {
        cached = { ts: Date.now(), events };
        return events;
      })
      .catch(() => (cached ? cached.events : []))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
