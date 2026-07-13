// ─────────────────────────────────────────────────────────────────────────────
//  GET /cockpit/live-feed/diag/session?sid= — TIMELINE fusionnée d'une session
//  Spec Claude 07/07 (§6). Protégé par token. Fusionne :
//    • les events UI du sid (JSONL, uiTelemetryStore)
//    • les appels AMONT du ring serveur (telemetry) dans la fenêtre temporelle
//  → une timeline unique triée : action UI → fetch → amont → erreur.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { diagAuthorized } from '@/lib/diagAuth';
import { readSession } from '@/lib/uiTelemetryStore';
import { telemetrySnapshot } from '@/lib/telemetry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Row {
  at: number;
  channel: 'ui' | 'fetch' | 'error' | 'amont';
  label: string;
  detail: Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  if (!diagAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sid = (req.nextUrl.searchParams.get('sid') || '').trim();
  if (!sid) return NextResponse.json({ error: 'sid' }, { status: 400 });

  const events = await readSession(sid);
  const rows: Row[] = events.map((e) => {
    const channel: Row['channel'] =
      e.t === 'fetch' ? 'fetch' : e.t === 'js_error' || e.t === 'promise_reject' ? 'error' : 'ui';
    return { at: e.srv, channel, label: e.t, detail: e.d };
  });

  // Fenêtre temporelle de la session → on greffe les appels amont concernés.
  if (rows.length > 0) {
    const first = Math.min(...rows.map((r) => r.at)) - 5_000;
    const last = Math.max(...rows.map((r) => r.at)) + 5_000;
    for (const c of telemetrySnapshot().recent) {
      if (c.at >= first && c.at <= last) {
        rows.push({
          at: c.at,
          channel: 'amont',
          label: c.source,
          detail: { ok: c.ok, status: c.status, ms: c.ms, count: c.count, note: c.note },
        });
      }
    }
  }

  rows.sort((a, b) => a.at - b.at);
  return NextResponse.json({ sid, rows }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
