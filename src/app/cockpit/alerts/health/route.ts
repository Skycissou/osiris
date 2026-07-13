// ─────────────────────────────────────────────────────────────────────────────
//  GET /cockpit/alerts/health — Monitoring « outcome » des Alertes disparitions
//
//  Spec Claude chat v1.1 (§11). LE vrai moniteur : mesure le RÉSULTAT (dernière
//  synchro réussie par source + nb d'avis actifs) → détecte TOUT (workflow n8n
//  désactivé, n8n down, token cassé, source morte), pas juste les erreurs.
//  Le badge de fraîcheur de l'UI le lit (🟢 <20 min · 🟠 20-45 · 🔴 >45/aucune).
//
//  Sous /cockpit — PAS /api/*.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getHealth } from '@/lib/alertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const health = await getHealth();
  return NextResponse.json(health, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
