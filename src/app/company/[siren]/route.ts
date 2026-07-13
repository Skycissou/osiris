// GET /company/{siren} — fiche entreprise par SIREN. Miroir FastAPI : lance la
// recherche standard sur le SIREN (classifyQuery → entreprises + BODACC).
import { searchStandard } from '@/lib/search/orchestrator';
import { withAuth } from '@/lib/search/withAuth';

export const dynamic = 'force-dynamic';

async function handler(_request: Request, ctx: { params: Promise<{ siren: string }> }): Promise<Response> {
  const { siren } = await ctx.params;
  try {
    const response = await searchStandard(siren);
    return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json(
      { error: 'Erreur fiche entreprise', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// withAuth attend (request) → on referme sur ctx via une lambda.
export function GET(request: Request, ctx: { params: Promise<{ siren: string }> }): Promise<Response> | Response {
  return withAuth((req) => handler(req, ctx))(request);
}
