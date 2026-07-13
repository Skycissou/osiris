// GET /report/markdown?q= — rapport markdown de la recherche (téléchargé par la landing).
import { searchStandard } from '@/lib/search/orchestrator';
import { renderMarkdownReport } from '@/lib/search/exports';
import { withAuth } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return Response.json({ error: 'Paramètre q requis' }, { status: 400 });
  const md = renderMarkdownReport(await searchStandard(q));
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="osiris-rapport.md"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withAuth(handler);
