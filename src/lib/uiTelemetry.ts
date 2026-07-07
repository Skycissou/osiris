// ─────────────────────────────────────────────────────────────────────────────
//  uiTelemetry.ts — Tracker CLIENT de la télémétrie UI (navigateur only)
//  Spec Claude 07/07 (§3). Session anonyme par onglet, buffer + batch, captures
//  automatiques (page, fetch applicatif, erreurs JS). FAIL-SAFE ABSOLU : tout
//  est enveloppé try/catch, un ingest KO ne casse JAMAIS l'UI.
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { BASE_PATH } from '@/lib/api';
import { CAPS, type UiEvent } from '@/lib/uiTelemetryTypes';

const INGEST = `${BASE_PATH}/telemetry/ui`;
const FLUSH_MS = 10_000;
const FLUSH_AT = 20; // events → flush anticipé
const MAP_MOVE_THROTTLE_MS = 5_000;
const ERR_DEDUP_MS = 30_000;

let sid = '';
let buffer: UiEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let lastMapMove = 0;
const errSeen = new Map<string, { n: number; at: number }>();

/** sid anonyme par onglet (sessionStorage). Meurt avec l'onglet. */
function getSid(): string {
  try {
    let s = sessionStorage.getItem('osiris.sid');
    if (!s) {
      s = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
      sessionStorage.setItem('osiris.sid', s);
    }
    return s;
  } catch {
    return 'nosid';
  }
}

/** Émet un événement (bufferisé). Ne throw jamais. */
export function track(t: string, d: Record<string, unknown> = {}): void {
  try {
    if (!started) return;
    buffer.push({ t, at: Date.now(), d });
    if (buffer.length > CAPS.bufferMax) buffer.splice(0, buffer.length - CAPS.bufferMax); // drop les + vieux
    if (buffer.length >= FLUSH_AT) flush();
  } catch {
    /* jamais casser l'UI */
  }
}

/** map_move throttlé (1 evt / 5 s max). */
export function trackMapMove(zoom: number): void {
  const now = Date.now();
  if (now - lastMapMove < MAP_MOVE_THROTTLE_MS) return;
  lastMapMove = now;
  track('map_move', { zoom });
}

/** Envoie le buffer (sendBeacon si possible, sinon fetch). Vide le buffer. */
function flush(useBeacon = false): void {
  try {
    if (buffer.length === 0) return;
    const batch = buffer.slice(0, CAPS.eventsPerBatch);
    buffer = buffer.slice(batch.length);
    const body = JSON.stringify({ sid, events: batch });
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(INGEST, new Blob([body], { type: 'application/json' }));
      return;
    }
    // keepalive : survit à une navigation ; erreurs avalées.
    void fetch(INGEST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {});
  } catch {
    /* drop silencieux */
  }
}

/** URLs applicatives à tracer (same-origin, sous basePath). Exclut le bruit. */
function isTrackableFetch(url: string): boolean {
  try {
    // Ne garder que les chemins relatifs applicatifs.
    if (/^https?:\/\//i.test(url)) return false; // hôte externe → non
    if (url.includes('/telemetry/ui')) return false; // anti-boucle
    if (url.includes('/_next/') || /\.(png|jpe?g|svg|css|js|woff2?|json|pbf|mvt)(\?|$)/i.test(url)) return false;
    const p = `${BASE_PATH}/`;
    return (
      url.startsWith(`${p}live-feed/`) ||
      url.startsWith(`${p}osint/`) ||
      url.startsWith(`${p}news`) ||
      url.startsWith(`${p}entity/`) ||
      url.startsWith(`${p}analyze`) ||
      url.startsWith('/search') ||
      url.startsWith(`${p}search`)
    );
  } catch {
    return false;
  }
}

/** Wrap global de fetch : logge les fetchs applicatifs (statut, ms). */
function wrapFetch(): void {
  if (typeof window === 'undefined') return;
  const orig = window.fetch;
  if ((orig as unknown as { __osirisWrapped?: boolean }).__osirisWrapped) return;
  const wrapped: typeof window.fetch = async (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : (input as Request).url;
    const trackable = isTrackableFetch(url);
    const started2 = Date.now();
    // Ajoute le sid (préparation v2, inoffensif) sur les fetchs applicatifs.
    let init2 = init;
    if (trackable) {
      try {
        const h = new Headers(init?.headers || (typeof input !== 'string' && !(input instanceof URL) ? (input as Request).headers : undefined));
        h.set('X-Osiris-Session', sid);
        init2 = { ...init, headers: h };
      } catch {
        init2 = init;
      }
    }
    try {
      const res = await orig(input as RequestInfo, init2);
      if (trackable) {
        const short = url.replace(BASE_PATH, '').split('?')[0];
        track('fetch', { path: short, status: res.status, ms: Date.now() - started2, ok: res.ok });
      }
      return res;
    } catch (e) {
      if (trackable) {
        const short = url.replace(BASE_PATH, '').split('?')[0];
        track('fetch', { path: short, status: 0, ms: Date.now() - started2, ok: false });
      }
      throw e;
    }
  };
  (wrapped as unknown as { __osirisWrapped?: boolean }).__osirisWrapped = true;
  window.fetch = wrapped;
}

/** Erreur avec dédup 30 s (même msg+src+line → incrémente n). */
function trackError(t: 'js_error' | 'promise_reject', d: Record<string, unknown>): void {
  const key = `${d.msg}|${d.src ?? ''}|${d.line ?? ''}`;
  const now = Date.now();
  const seen = errSeen.get(key);
  if (seen && now - seen.at < ERR_DEDUP_MS) {
    seen.n += 1;
    seen.at = now;
    track(t, { ...d, n: seen.n });
    return;
  }
  errSeen.set(key, { n: 1, at: now });
  track(t, { ...d, n: 1 });
}

/** Initialise le tracker (idempotent). Appelé une fois au montage du cockpit. */
export function initUiTelemetry(): void {
  try {
    if (started || typeof window === 'undefined') return;
    started = true;
    sid = getSid();
    wrapFetch();

    window.addEventListener('error', (e) => {
      trackError('js_error', { msg: e.message, src: e.filename, line: e.lineno });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason = (e as PromiseRejectionEvent).reason;
      trackError('promise_reject', { msg: reason instanceof Error ? reason.message : String(reason) });
    });
    // Flush fiable au départ de la page.
    const bye = () => flush(true);
    window.addEventListener('pagehide', bye);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });

    flushTimer = setInterval(() => flush(), FLUSH_MS);
    track('page', { path: location.pathname });
  } catch {
    /* init KO → tracker inactif, UI intacte */
  }
}

/** Arrêt propre (rarement utile ; symétrie). */
export function stopUiTelemetry(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
  started = false;
}
