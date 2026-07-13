// GET /report/csv?q=&file=(metadata|results).csv — export CSV de la recherche.
import { searchStandard } from '@/lib/search/orchestrator';
import { renderCsvBundle } from '@/lib/search/exports';
import { withAuth } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return Response.json({ error: 'Paramètre q requis' }, { status: 400 });
  const fileParam = url.searchParams.get('file') || 'results.csv';
  const file = /^(metadata|results)\.csv$/.test(fileParam) ? fileParam : 'results.csv';
  const bundle = renderCsvBundle(await searchStandard(q));
  return new Response(bundle[file], {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withAuth(handler);
