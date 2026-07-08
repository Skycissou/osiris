// ─────────────────────────────────────────────────────────────────────────────
//  POST /cockpit/alerts/ingest — Ingest des « Alertes disparitions » (n8n → OSIRIS)
//
//  Spec Claude chat 08/07 (§3/§8). Alimenté par le workflow n8n (cron 15 min) qui
//  envoie le LOT COMPLET COURANT d'une source → upsert + réconciliation (§6).
//
//  AUTH : en-tête `X-Ingest-Token` = `OSIRIS_INGEST_TOKEN` (.env). 401 sinon.
//  (Pas de same-origin : l'appelant est n8n, serveur→serveur.) Rate-limit basique.
//  Payload validé à la main (pas de dépendance zod). Photos : URL hotlink SEULEMENT,
//  jamais de copie locale (RGPD §6).
//
//  ⚠️ Sous /cockpit (basePath) — PAS /api/* (Traefik strippe /api → V3 FastAPI).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { upsertSource, isAlertSource, type Alert, type AlertSource } from '@/lib/alertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // écriture disque

const MAX_BYTES = 512 * 1024; // lot complet d'une source, borné
const MAX_ALERTS = 500; // Interpol Yellow ~160 max, marge confortable
const STR = 300; // longueur max d'une string de champ

// Rate-limit mémoire simple (protégé double instance).
type RL = { count: number; windowStart: number };
const G = globalThis as unknown as { __osirisAlertsRL?: RL };
const RL_MAX = 20; // 20 ingest/min (le cron est à 15 min → large)
const RL_WINDOW = 60_000;
function rateLimited(): boolean {
  const now = Date.now();
  const e = G.__osirisAlertsRL;
  if (!e || now - e.windowStart > RL_WINDOW) {
    G.__osirisAlertsRL = { count: 1, windowStart: now };
    return false;
  }
  e.count += 1;
  return e.count > RL_MAX;
}

const trunc = (v: unknown, max = STR): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
};
const httpUrl = (v: unknown): string | undefined => {
  const s = trunc(v, 1000);
  return s && /^https?:\/\//i.test(s) ? s : undefined; // hotlink http(s) only
};
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Nettoie un avis brut du payload → Alert (champs whitelistés, id stable). */
function sanitize(source: AlertSource, raw: unknown): Alert | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const source_id = trunc(o.source_id, 200);
  if (!source_id) return null; // pas d'id source → inexploitable (dédup impossible)
  const lat = num(o.lat);
  const lon = num(o.lon);
  const age = num(o.age);
  const sexeRaw = trunc(o.sexe, 8);
  return {
    id: `${source}:${source_id}`,
    source,
    source_id,
    url_source: httpUrl(o.url_source),
    nom_affiche: trunc(o.nom_affiche, 200),
    ...(age !== undefined && age >= 0 && age < 130 ? { age: Math.round(age) } : {}),
    ...(sexeRaw ? { sexe: sexeRaw } : {}),
    date_publication: trunc(o.date_publication, 40),
    lieu_texte: trunc(o.lieu_texte, STR),
    ...(lat !== undefined && lat >= -90 && lat <= 90 ? { lat } : {}),
    ...(lon !== undefined && lon >= -180 && lon <= 180 ? { lon } : {}),
    photo_url: httpUrl(o.photo_url), // JAMAIS de copie locale — URL source only
    statut: 'active',
    fetched_at: Date.now(),
  };
}

export async function POST(req: NextRequest) {
  // Auth par token dédié (secret fort en .env). Défini obligatoirement.
  const expected = (process.env.OSIRIS_INGEST_TOKEN || '').trim();
  if (!expected) return NextResponse.json({ error: 'ingest désactivé (OSIRIS_INGEST_TOKEN absent)' }, { status: 503 });
  const provided = (req.headers.get('x-ingest-token') || '').trim();
  if (!provided || provided !== expected) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (rateLimited()) return NextResponse.json({ error: 'rate' }, { status: 429 });

  const rawBody = await req.text();
  if (rawBody.length > MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 400 });

  let payload: { source?: unknown; alerts?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'json' }, { status: 400 });
  }

  const source = payload.source;
  if (!isAlertSource(source)) return NextResponse.json({ error: 'source inconnue' }, { status: 400 });
  const rawAlerts = Array.isArray(payload.alerts) ? payload.alerts : null;
  if (!rawAlerts) return NextResponse.json({ error: 'alerts[] requis (lot complet de la source)' }, { status: 400 });
  if (rawAlerts.length > MAX_ALERTS) return NextResponse.json({ error: 'too_many' }, { status: 400 });

  const clean: Alert[] = [];
  for (const r of rawAlerts) {
    const a = sanitize(source, r);
    if (a) clean.push(a);
  }

  const result = await upsertSource(source, clean);
  return NextResponse.json({ ok: true, source, ...result }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
