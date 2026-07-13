// ─────────────────────────────────────────────────────────────────────────────
//  /cockpit/admin/keys — Coffre de clés « couches » côté serveur (opérateur only)
//
//  Retour Cissou 07/07 : un utilisateur ne peut pas faire du SSH. L'opérateur
//  saisit ICI (page admin, protégée par token) les clés OpenSky/FIRMS/AIS →
//  écrites dans le coffre serveur (serverKeyStore) → lues par le collecteur et
//  les routes. Zéro SSH, persistant.
//
//  GET  : statut (présence + longueur, JAMAIS la valeur). Token requis.
//  POST : { keys: { service: value|"" } } → enregistre/efface. Token + same-origin.
//
//  Sous /cockpit (basePath) ; JAMAIS /api/* (Traefik strip → 404).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { diagAuthorized } from '@/lib/diagAuth';
import {
  ensureKeysLoaded,
  setServerKeys,
  serverKeyStatus,
  SERVER_MANAGED_SERVICES,
} from '@/lib/serverKeyStore';
import { applyServerOpenskyCreds } from '@/lib/aircraftCollector';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // écriture disque

/** Same-origin (Origin/Referer host === host de la requête). */
function sameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  const src = req.headers.get('origin') || req.headers.get('referer');
  if (!src) return false;
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!diagAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await ensureKeysLoaded();
  return NextResponse.json(
    { services: [...SERVER_MANAGED_SERVICES], keys: serverKeyStatus() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: NextRequest) {
  if (!diagAuthorized(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!sameOrigin(req)) return NextResponse.json({ error: 'origin' }, { status: 403 });

  let body: { keys?: unknown };
  try {
    body = (await req.json()) as { keys?: unknown };
  } catch {
    return NextResponse.json({ error: 'json' }, { status: 400 });
  }
  const keys = body.keys;
  if (!keys || typeof keys !== 'object') return NextResponse.json({ error: 'shape' }, { status: 400 });

  // On ne retient que les services gérés (setServerKeys re-filtre aussi).
  const partial: Record<string, string | null> = {};
  for (const s of SERVER_MANAGED_SERVICES) {
    const v = (keys as Record<string, unknown>)[s];
    if (typeof v === 'string') partial[s] = v; // '' = suppression
  }

  await setServerKeys(partial);
  // Applique les identifiants OpenSky au collecteur EN LIVE (sans redémarrage).
  applyServerOpenskyCreds();

  return NextResponse.json(
    { ok: true, keys: serverKeyStatus() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
