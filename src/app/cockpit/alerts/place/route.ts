// ─────────────────────────────────────────────────────────────────────────────
//  POST /cockpit/alerts/place — Placement MANUEL d'un avis sur la carte
//
//  Demande Cissou 09/07 : pour un avis « sans position » (typique : les Interpol
//  sans lieu publié), l'utilisateur saisit une localité (ville / code postal /
//  département) → OSIRIS la géocode et pose l'avis sur la carte. L'override est
//  persisté (survit au ré-upsert du lot). RGPD : on ne stocke qu'une position.
//
//  Auth : same-origin (action depuis le cockpit loggué), comme GET /alerts.
//  ⚠️ Sous /cockpit (basePath) — PAS /api/* (strippé vers V3 FastAPI).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { setManualPlacement } from '@/lib/alertsStore';
import { geocodeLocality } from '@/lib/geocode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  const src = req.headers.get('origin') || req.headers.get('referer');
  if (!src) return true; // navigation directe tolérée
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: 'origin' }, { status: 403 });

  let body: { id?: unknown; locality?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: 'json' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id.trim().slice(0, 300) : '';
  const locality = typeof body.locality === 'string' ? body.locality.trim().slice(0, 120) : '';
  if (!id) return NextResponse.json({ ok: false, error: 'id requis' }, { status: 400 });
  if (locality.length < 2) return NextResponse.json({ ok: false, error: 'localité trop courte' }, { status: 400 });

  const hit = await geocodeLocality(locality); // seule la localité sort (RGPD), jamais le nom
  if (!hit) return NextResponse.json({ ok: false, error: 'localité introuvable' }, { status: 422 });

  const ok = await setManualPlacement(id, hit.lat, hit.lon);
  if (!ok) return NextResponse.json({ ok: false, error: 'avis inconnu' }, { status: 404 });

  return NextResponse.json(
    { ok: true, id, lat: hit.lat, lon: hit.lon },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
