// ─────────────────────────────────────────────────────────────────────────────
//  /live-feed/diag — MONITORING (demande Cissou 07/07)
//
//  Renvoie l'état de TOUTES les requêtes amont du cockpit : compteurs ok/échec
//  par source (adsb.lol, USGS, celestrak, gdelt-doc/export, abuse.ch, opensky,
//  FIRMS…), latences, 40 derniers appels + santé du collecteur d'avions.
//  Sert à vérifier qu'on a bien toutes les réponses et à débugger sans deviner.
//
//  URL finale : /cockpit/live-feed/diag (basePath ; JAMAIS /api/* — Traefik).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { telemetrySnapshot } from '@/lib/telemetry';
import { collectorHealth } from '@/lib/aircraftCollector';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { telemetry: telemetrySnapshot(), aircraftCollector: collectorHealth(), ts: Date.now() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
