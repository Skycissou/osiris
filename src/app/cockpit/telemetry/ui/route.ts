// ─────────────────────────────────────────────────────────────────────────────
//  POST /cockpit/telemetry/ui — Ingest de la télémétrie UI (serveur only)
//  Spec Claude 07/07 (§4). Validation stricte, rate-limit par sid, kill-switch,
//  minimisation (ni IP ni user-agent). Append JSONL via uiTelemetryStore.
//
//  Route sous /cockpit (basePath) ; JAMAIS /api/* (Traefik strip → 404).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { appendEvents, type StoredEvent } from '@/lib/uiTelemetryStore';
import { CAPS, UI_EVENT_TYPE_SET, trunc } from '@/lib/uiTelemetryTypes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // écriture disque

// Rate-limit mémoire par sid (protégé contre double instance, comme telemetry).
type RL = Map<string, { count: number; windowStart: number }>;
const G = globalThis as unknown as { __osirisUiTelRL?: RL };
const rl: RL = G.__osirisUiTelRL ?? new Map();
G.__osirisUiTelRL = rl;
const RL_MAX = 120; // req / min / sid
const RL_WINDOW = 60_000;

function rateLimited(sid: string): boolean {
  const now = Date.now();
  const e = rl.get(sid);
  if (!e || now - e.windowStart > RL_WINDOW) {
    rl.set(sid, { count: 1, windowStart: now });
    return false;
  }
  e.count += 1;
  return e.count > RL_MAX;
}

/** Same-origin ? (Origin/Referer doit matcher l'hôte de la requête.) */
function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const src = origin || referer;
  if (!src) return false; // sendBeacon envoie l'Origin ; sans rien → refus
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

/** Nettoie le détail d'un event selon son type (troncatures, whitelist champs). */
function sanitizeDetail(t: string, d: unknown): Record<string, unknown> {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined) out[k] = v;
  };
  switch (t) {
    case 'layer_toggle':
      put('layer', trunc(o.layer, 40));
      put('on', typeof o.on === 'boolean' ? o.on : undefined);
      break;
    case 'layer_filter':
      put('layer', trunc(o.layer, 40));
      put('filter', trunc(o.filter, CAPS.strLen));
      break;
    case 'search':
      put('q', trunc(o.q, CAPS.qLen));
      put('kind', trunc(o.kind, 40));
      break;
    case 'osint_lookup':
      put('tool', trunc(o.tool, 40));
      put('q', trunc(o.q, CAPS.qLen));
      break;
    case 'news_click':
      put('source', trunc(o.source, CAPS.strLen));
      break;
    case 'entity_open':
      put('kind', trunc(o.kind, 40));
      break;
    case 'graph_action':
      put('action', trunc(o.action, 40));
      break;
    case 'preset_apply':
      put('name', trunc(o.name, 60));
      break;
    case 'shortcut':
      put('key', trunc(o.key, 20));
      break;
    case 'share_create':
      break;
    case 'apikey_save':
      // ⚠️ JAMAIS la valeur de la clé : on ne garde QUE le nom du service.
      put('service', trunc(o.service, 40));
      break;
    case 'map_move':
      put('zoom', typeof o.zoom === 'number' ? Math.round(o.zoom * 10) / 10 : undefined);
      break;
    case 'page':
      put('path', trunc(o.path, CAPS.strLen));
      break;
    case 'fetch':
      put('path', trunc(o.path, CAPS.strLen));
      put('status', typeof o.status === 'number' ? o.status : undefined);
      put('ms', typeof o.ms === 'number' ? Math.round(o.ms) : undefined);
      put('ok', typeof o.ok === 'boolean' ? o.ok : undefined);
      break;
    case 'js_error':
      put('msg', trunc(o.msg, CAPS.msgLen));
      put('src', trunc(o.src, CAPS.strLen));
      put('line', typeof o.line === 'number' ? o.line : undefined);
      put('n', typeof o.n === 'number' ? o.n : undefined);
      break;
    case 'promise_reject':
      put('msg', trunc(o.msg, CAPS.msgLen));
      put('n', typeof o.n === 'number' ? o.n : undefined);
      break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  // Kill-switch runtime (pas de rebuild).
  if ((process.env.OSIRIS_UI_TELEMETRY || 'on').toLowerCase() === 'off') {
    return new NextResponse(null, { status: 204 });
  }
  if (!sameOrigin(req)) return NextResponse.json({ error: 'origin' }, { status: 403 });

  // Taille brute ≤ 32 Ko.
  const raw = await req.text();
  if (raw.length > CAPS.batchBytes) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  let payload: { sid?: unknown; events?: unknown };
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'json' }, { status: 400 });
  }

  const sid = typeof payload.sid === 'string' ? payload.sid.slice(0, 64) : '';
  const events = Array.isArray(payload.events) ? payload.events : null;
  if (!sid || !events) return NextResponse.json({ error: 'shape' }, { status: 400 });
  if (events.length > CAPS.eventsPerBatch) return NextResponse.json({ error: 'too_many' }, { status: 400 });
  if (rateLimited(sid)) return NextResponse.json({ error: 'rate' }, { status: 429 });

  const srv = Date.now();
  const stored: StoredEvent[] = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const e = ev as { t?: unknown; at?: unknown; d?: unknown };
    if (typeof e.t !== 'string' || !UI_EVENT_TYPE_SET.has(e.t)) continue; // type inconnu → rejet silencieux
    stored.push({
      sid,
      at: typeof e.at === 'number' ? e.at : srv,
      srv,
      t: e.t,
      d: sanitizeDetail(e.t, e.d),
    });
  }

  await appendEvents(stored);
  return NextResponse.json({ ok: true, stored: stored.length }, { status: 200 });
}
