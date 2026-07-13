// ─────────────────────────────────────────────────────────────────────────────
//  GET /cockpit/alerts?statut=active — Liste des « Alertes disparitions »
//
//  Spec Claude chat 08/07 (§3). Lue par la couche carto + le panneau (Lot 2).
//  Renvoie les avis actifs (complets) et, sans filtre, aussi les levés < 24 h
//  (déjà ANONYMISÉS côté store — ni nom ni photo). Purge auto au fil de l'eau.
//
//  Same-origin uniquement (lu par le cockpit) ; données déjà publiques + non
//  nominatives une fois levées. Sous /cockpit — PAS /api/*.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { listAlerts } from '@/lib/alertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  const src = req.headers.get('origin') || req.headers.get('referer');
  if (!src) return true; // navigation directe (barre d'adresse) tolérée en lecture
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'origin' }, { status: 403 });
  const onlyActive = req.nextUrl.searchParams.get('statut') === 'active';
  const alerts = await listAlerts(onlyActive);
  return NextResponse.json(
    { alerts, count: alerts.length },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
