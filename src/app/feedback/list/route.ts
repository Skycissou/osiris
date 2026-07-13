// GET /feedback/list — retours reçus (admin). Gaté par token (pattern ingest) tant
// que la vraie auth (Lot C) n'est pas là : ?token= ou Authorization: Bearer, comparé
// à OSIRIS_ADMIN_TOKEN. Renvoie du JSON (les plus récents d'abord).
import { listFeedback } from '@/lib/search/feedback';
import { requireToken } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = requireToken(request, 'OSIRIS_ADMIN_TOKEN');
  if (denied) return denied;
  const rows = await listFeedback();
  return Response.json({ count: rows.length, feedback: rows }, { headers: { 'Cache-Control': 'no-store' } });
}
