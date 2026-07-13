// GET /version (racine) — version V4, pour le nag « mettre à jour » de la landing
// (public/landing/app.js appelle /version). Le cockpit lit /cockpit/version.
import { OSIRIS_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ version: OSIRIS_VERSION }, { headers: { 'Cache-Control': 'no-store' } });
}
