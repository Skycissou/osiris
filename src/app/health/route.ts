// GET /health — ping du moteur de recherche natif (racine). Miroir de la route
// FastAPI /health. Utilisé par src/lib/api.ts::apiHealth.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok', service: 'osiris-v4-search' }, { headers: { 'Cache-Control': 'no-store' } });
}
