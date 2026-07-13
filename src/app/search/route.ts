// GET /search — recherche universelle (Phase 1 du moteur natif Next).
// Appelée par l'accueil (public/landing/app.js) ET le cockpit (src/lib/api.ts,
// API_BASE=''). Renvoie EXACTEMENT le shape `SearchResponse` (types = la loi).
// Routes physiques à la RACINE → chemins des 2 fronts INCHANGÉS (arbitrage 3).

import { searchStandard } from '@/lib/search/orchestrator';
import { withAuth } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

// Clés de filtre reconnues (miroir de SearchFilters dans src/lib/api.ts).
const FILTER_KEYS = ['naf', 'departement', 'code_postal', 'effectif', 'categorie', 'etat', 'rge', 'ess', 'qualiopi', 'association', 'bio'] as const;

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

  if (!q) {
    return Response.json({ error: 'Paramètre q requis' }, { status: 400 });
  }

  const filters: Record<string, string> = {};
  for (const k of FILTER_KEYS) {
    const v = url.searchParams.get(k);
    if (v != null && v !== '') filters[k] = v;
  }

  try {
    const response = await searchStandard(q, { filters, page });
    return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json(
      { error: 'Erreur moteur de recherche', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = withAuth(handler);
