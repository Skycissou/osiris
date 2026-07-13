// POST /cockpit/arpd/sync — déclenche un sync ARPD. Cadence PROPRE = n8n cron 6 h
// (PAS le cron 15 min des autres sources). Gaté par token (même credential que
// l'ingest alertes : OSIRIS_INGEST_TOKEN) → seul n8n peut déclencher.
import { runArpdSync } from '@/lib/arpd/sync';

export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = process.env.OSIRIS_ARPD_TOKEN || process.env.OSIRIS_INGEST_TOKEN;
  if (!expected) return false; // pas de token configuré → refus (fail-safe)
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || new URL(request.url).searchParams.get('token');
  return got === expected;
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ error: 'Non autorisé' }, { status: 401 });
  }
  try {
    const result = await runArpdSync();
    return Response.json({ ok: !result.aborted, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
