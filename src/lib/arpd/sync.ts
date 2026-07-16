// ─────────────────────────────────────────────────────────────────────────
//  Sync ARPD → pipeline alertes existant. Cadence PROPRE (n8n cron 6 h, PAS le
//  cron 15 min). Étapes : fetch pages → SANITY CHECK (≥70 %, bloquant : un fetch
//  partiel ne doit JAMAIS déclencher des retraits massifs) → géocode (ville IGN,
//  sinon centroïde dépt) → DIFF avec grâce 2 syncs → upsertSource('arpd', …).
//
//  ⚠️ Règles dures du brief : retrait miroir (2 syncs → levée) · attribution +
//  lien original (url_source) · photo hotlink jamais copiée · UA identifié · 1 req/s.
// ─────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseListing, parseDetailPhoto, ARPD_BASE, type ArpdAvisParsed } from './parser';
import { deptCentroid } from './deptCentroid';
import { geocodeLocality } from '@/lib/geocode';
import { upsertSource, normalizeCategorie, type Alert } from '@/lib/alertsStore';
import { computeDiff, type ArpdState } from './diff';

const UA = 'OSIRIS-ARPD-sync/1.0 (benevole ARPD Occitanie)';
const LISTING = `${ARPD_BASE}/fr/recherche-disparition`;
const MAX_PAGES = 10;               // garde-fou (≈100 avis/page → 1000 avis max)
const SANITY_RATIO = 0.7;           // total < 70 % du dernier connu → ABORT
const PAGE_DELAY_MS = 1100;         // courtoisie ARPD : 1 req/s ENTRE LES PAGES (pas le géocodage)
// Cap de géocodage VILLE par run : au-delà, l'avis prend le centroïde département
//  (pin immédiat « approx. », `geoPrecision: 'departement'`). B1 (dette) : un avis
//  figé au centroïde est RÉELLEMENT re-tenté aux syncs suivants (dans ce budget) tant
//  qu'il n'est pas passé en `geoPrecision: 'ville'` — avant, la condition de réutilisation
//  sur `lat !== undefined` le figeait à vie. geocodeLocality s'auto-throttle → PAS de
//  délai en plus ici (c'était le bug du 1er run : ~400 × 1,1 s = plusieurs minutes).
const MAX_VILLE_GEOCODE_PER_RUN = 150;
// Repli PHOTO via page détail : certains avis « legacy » ont le champ image du
// listing VIDE, mais portent leur photo sous /uploaded/<slug>.jpg sur leur page
// détail. On va la chercher UNIQUEMENT pour ces avis-là, throttlé 1 req/s
// (courtoisie ARPD, comme les pages). Cap/run pour borner la durée (~66 avis
// concernés × 1,1 s ≈ 1 min ajoutée au 1er run, puis mémorisé → runs suivants légers).
const MAX_DETAIL_PHOTO_PER_RUN = 80;

function dir(): string {
  return process.env.OSIRIS_ALERTS_DIR || path.join(process.cwd(), 'data');
}
function stateFile(): string {
  return path.join(dir(), 'arpd-state.json');
}

async function loadState(): Promise<ArpdState> {
  try {
    const raw = await fs.readFile(stateFile(), 'utf-8');
    const s = JSON.parse(raw) as ArpdState;
    if (s && typeof s.lastTotal === 'number' && s.seen) return s;
  } catch { /* première exécution */ }
  return { lastTotal: 0, updatedAt: 0, seen: {} };
}
async function saveState(s: ArpdState): Promise<boolean> {
  // Résilient (comme alertsStore) : un volume non inscriptible ne doit PAS faire
  // échouer le sync (les avis sont déjà dans le store en mémoire). ⚠️ Sans
  // persistance, la grâce 2-syncs + le cache coords ne survivent pas à un restart
  // → corriger les DROITS du volume (chown uid 1001) pour une durabilité réelle.
  try {
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(stateFile(), JSON.stringify(s), { encoding: 'utf-8', mode: 0o600 });
    return true;
  } catch (e) {
    console.warn('[ARPD] arpd-state non persisté (droits volume ?) :', e instanceof Error ? e.message : e);
    return false;
  }
}

async function fetchPage(page: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${LISTING}?page=${page}`, { headers: { 'User-Agent': UA }, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status} page ${page}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Photo de repli via la page détail d'un avis (avis « legacy » /uploaded/). */
async function fetchDetailPhoto(pageUrl: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': UA }, signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    return parseDetailPhoto(await res.text());
  } catch {
    return null; // page détail KO → l'avis reste sans photo, jamais de crash
  } finally {
    clearTimeout(timer);
  }
}

/** Récupère TOUTES les pages (jusqu'à page vide ou MAX_PAGES). 1 req/s. */
async function fetchAll(): Promise<ArpdAvisParsed[]> {
  const all: ArpdAvisParsed[] = [];
  const seenIds = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const html = await fetchPage(page);
    const avis = parseListing(html);
    if (avis.length === 0) break; // plus d'avis → fin de pagination
    let added = 0;
    for (const a of avis) if (!seenIds.has(a.id)) { seenIds.add(a.id); all.push(a); added++; }
    if (added === 0) break; // page identique (fin) → stop
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS)); // courtoisie ARPD entre pages
  }
  return all;
}

function categorieFor(source: string): string {
  if (source === 'Gendarmerie' || source === 'Police') return 'disparition_inquietante';
  return 'disparition';
}

/** Mappe un avis ARPD (déjà géocodé) vers l'Alert du store existant.
 *  `photoUrl` : photo résolue (listing OU repli page détail) — peut être null. */
function toAlert(a: ArpdAvisParsed, coords: { lat: number; lon: number } | null, geoPrecision: 'ville' | 'departement' | null, photoUrl: string | null, photoProbed: boolean): Alert {
  const lieu = [a.ville, a.deptNom].filter(Boolean).join(' · ') || null;
  const details: { label: string; value: string }[] = [];
  if (a.source) details.push({ label: "Source d'origine", value: String(a.source) });
  if (geoPrecision) details.push({ label: 'Précision géo', value: geoPrecision === 'ville' ? 'Ville' : 'Département (approximatif)' });
  if (a.region) details.push({ label: 'Région', value: a.region });
  // titreBrut TOUJOURS conservé (fallback si parsing partiel).
  details.push({ label: 'Intitulé original', value: a.titreBrut });

  return {
    id: `arpd:${a.id}`,
    source: 'arpd',
    source_id: a.id,
    categorie: normalizeCategorie(categorieFor(String(a.source)), 'disparition'),
    url_source: a.url,                       // attribution + lien original (règle 2)
    nom_affiche: a.nom || a.titreBrut,
    age: a.age ?? undefined,
    date_publication: a.dateDisparition ?? undefined,
    lieu_texte: lieu ?? undefined,
    lat: coords?.lat,
    lon: coords?.lon,
    geoPrecision: geoPrecision ?? undefined, // B1 : sert la re-tentative ville au sync suivant
    photo_url: photoUrl ?? undefined,        // hotlink arpd.fr, jamais de copie (RGPD)
    photo_detail_probed: photoProbed || undefined, // B2 : page détail déjà sondée
    details,
    statut: 'active',
    fetched_at: Date.now(),
  };
}

export interface SyncResult {
  aborted?: boolean;
  reason?: string;
  total: number;
  actifs: number;
  nouveaux: number;
  geocodes_ville: number;
  geocodes_dept: number;
  sans_position: number;
  photos_detail?: number; // photos récupérées via page détail (avis legacy /uploaded/)
  state_persisted?: boolean;
}

/** Sync complet : fetch → sanity → géocode (NOUVEAUX seulement) → diff → store. */
export async function runArpdSync(): Promise<SyncResult> {
  const state = await loadState();
  const avis = await fetchAll();
  const total = avis.length;

  // SANITY CHECK bloquant : un fetch partiel ne doit pas retirer des disparus.
  if (state.lastTotal > 0 && total < SANITY_RATIO * state.lastTotal) {
    return { aborted: true, reason: `sanity: ${total} < 70% de ${state.lastTotal}`, total, actifs: 0, nouveaux: 0, geocodes_ville: 0, sans_position: 0, geocodes_dept: 0 };
  }

  let ville = 0, dept = 0, sansPos = 0, nouveaux = 0, villeGeocoded = 0, detailFetched = 0, detailPhotos = 0;
  const present: Alert[] = [];
  for (const a of avis) {
    const known = state.seen[`arpd:${a.id}`];
    // Réutilise coords des avis DÉJÀ vus (géocode = NOUVEAUX seulement).
    if (known?.alert && (known.alert.lat !== undefined || known.alert.lon !== undefined)) {
      let al: Alert = { ...known.alert, fetched_at: Date.now(), statut: 'active' };

      // B1 — RE-GÉOCODAGE VILLE : un avis figé au centroïde département (ou legacy
      //  sans `geoPrecision` mais déjà positionné → traité comme 'departement') est
      //  re-tenté vers sa ville dès qu'elle est dispo, dans le budget du run. Passe
      //  en 'ville' au succès → plus jamais re-tenté ensuite.
      const precision = al.geoPrecision ?? 'departement';
      if (precision === 'departement' && a.ville && villeGeocoded < MAX_VILLE_GEOCODE_PER_RUN) {
        villeGeocoded += 1;
        const c = await geocodeLocality([a.ville, a.deptCode || a.deptNom].filter(Boolean).join(' '));
        if (c) { al = { ...al, lat: c.lat, lon: c.lon, geoPrecision: 'ville' }; ville++; }
        // échec → on garde le centroïde, nouvelle tentative au prochain sync.
      }

      // B2 — PHOTO page détail : sondée UNE seule fois (résultat vide inclus). Le
      //  flag `photo_detail_probed` évite de re-fetcher en boucle à chaque sync et
      //  préserve le budget MAX_DETAIL_PHOTO_PER_RUN pour les avis pas encore sondés.
      if (!al.photo_url && !al.photo_detail_probed && detailFetched < MAX_DETAIL_PHOTO_PER_RUN) {
        detailFetched += 1;
        const p = await fetchDetailPhoto(a.url);
        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS)); // courtoisie 1 req/s
        al = { ...al, photo_detail_probed: true };
        if (p) { al = { ...al, photo_url: p }; detailPhotos++; }
      }
      present.push(al);
      continue;
    }
    nouveaux += 1;
    let coords: { lat: number; lon: number } | null = null;
    let precision: 'ville' | 'departement' | null = null;
    // Géocodage VILLE plafonné/run (geocodeLocality s'auto-throttle → pas de délai ici).
    if (a.ville && villeGeocoded < MAX_VILLE_GEOCODE_PER_RUN) {
      villeGeocoded += 1;
      coords = await geocodeLocality([a.ville, a.deptCode || a.deptNom].filter(Boolean).join(' '));
      if (coords) precision = 'ville';
    }
    // Repli INSTANT hors-ligne : centroïde département → tout avis (hors DOM inconnu) a un pin.
    if (!coords) {
      coords = deptCentroid(a.deptCode, a.deptNom);
      if (coords) precision = 'departement';
    }
    if (precision === 'ville') ville++; else if (precision === 'departement') dept++; else sansPos++;
    // Photo : listing d'abord ; sinon repli page détail (avis legacy), throttlé/borné.
    let photoUrl = a.photoUrl;
    let photoProbed = false;
    if (!photoUrl && detailFetched < MAX_DETAIL_PHOTO_PER_RUN) {
      detailFetched += 1;
      photoUrl = await fetchDetailPhoto(a.url);
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS)); // courtoisie 1 req/s
      photoProbed = true; // sondée (résultat vide inclus) → B2 : pas de re-fetch au prochain sync
      if (photoUrl) detailPhotos++;
    }
    present.push(toAlert(a, coords, precision, photoUrl, photoProbed));
  }

  const { incoming, newState } = computeDiff(present, total, state, Date.now());
  await upsertSource('arpd', incoming);
  const persisted = await saveState(newState);

  return { total, actifs: incoming.length, nouveaux, geocodes_ville: ville, geocodes_dept: dept, sans_position: sansPos, photos_detail: detailPhotos, state_persisted: persisted };
}
