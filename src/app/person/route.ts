// GET /person?nom=&prenoms= — recherche par personne (dirigeants diffusés).
import { searchPersonStandard } from '@/lib/search/orchestrator';
import { withAuth } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const nom = (url.searchParams.get('nom') || '').trim();
  const prenoms = (url.searchParams.get('prenoms') || '').trim();
  if (!nom) return Response.json({ error: 'Paramètre nom requis' }, { status: 400 });
  try {
    return Response.json(await searchPersonStandard(nom, prenoms), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ error: 'Erreur recherche personne', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withAuth(handler);
