// GET /investigate?q=|nom=|prenoms= — pivot OSINT en cascade (bornée).
import { investigateStandard } from '@/lib/search/orchestrator';
import { withAuth } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const nom = (url.searchParams.get('nom') || '').trim();
  const prenoms = (url.searchParams.get('prenoms') || '').trim();
  if (!q && !nom) return Response.json({ error: 'Paramètre q ou nom requis' }, { status: 400 });
  try {
    return Response.json(
      await investigateStandard({ q: q || undefined, nom: nom || undefined, prenoms: prenoms || undefined }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    return Response.json({ error: 'Erreur investigation', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withAuth(handler);
