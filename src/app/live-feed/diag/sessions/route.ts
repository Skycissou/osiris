// ─────────────────────────────────────────────────────────────────────────────
//  GET /cockpit/live-feed/diag/sessions — liste des sessions UI du jour
//  Spec Claude 07/07 (§6). Protégé par token (diagAuth). Renvoie sid, 1er/dernier
//  event, nb events, nb erreurs — pour choisir une session à inspecter.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { diagAuthorized } from '@/lib/diagAuth';
import { listSessionsToday } from '@/lib/uiTelemetryStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!diagAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sessions = await listSessionsToday();
  return NextResponse.json({ sessions }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
