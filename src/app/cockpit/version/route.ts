// ─────────────────────────────────────────────────────────────────────────────
//  /cockpit/version — expose la version du cockpit (source unique version.ts)
//
//  Demande Cissou 07/07 : le badge de l'accueil (V3, autre app) doit être
//  ASSUJETTI à la version du cockpit — plus de lockstep manuel qui dérive.
//  L'accueil (app.js) lit cet endpoint au chargement et écrit le badge.
//  Même domaine (osiris-v4.cissouhub.cloud) → fetch same-origin, pas de CORS.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { OSIRIS_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { version: OSIRIS_VERSION },
    { status: 200, headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } },
  );
}
