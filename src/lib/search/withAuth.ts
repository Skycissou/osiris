// ─────────────────────────────────────────────────────────────────────────
//  withAuth — frontière d'autorisation des routes de données (arbitrage 2 du plan).
//  Intérim : PASS-THROUGH tant que `AUTH_ENFORCE !== 'true'` (variable SERVEUR, PAS
//  NEXT_PUBLIC — la sécurité ne doit jamais dépendre d'un flag inliné client).
//  Lot C (Better Auth) : remplacer le corps du `if` par la vérif de session → 1 seul
//  point de bascule. ⚠️ Rappel brief auth : proxy.ts ≠ frontière ; LA frontière = ICI.
// ─────────────────────────────────────────────────────────────────────────

type Handler = (request: Request) => Promise<Response> | Response;

export function withAuth(handler: Handler): Handler {
  return async (request: Request) => {
    if (process.env.AUTH_ENFORCE === 'true') {
      // TODO Lot C : vérifier la session Better Auth ici ; 401 si absente.
      // (Dormant tant que l'instance est privée / cercle restreint.)
    }
    return handler(request);
  };
}

/** Protection par token de service (pattern ingest) — pour les routes sensibles
 *  dès maintenant (ex. /feedback/list en Phase 4). 401 si le token ne matche pas. */
export function requireToken(request: Request, envVar: string): Response | null {
  const expected = process.env[envVar];
  if (!expected) return new Response(JSON.stringify({ error: 'Service non configuré' }), { status: 503 });
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(request.url).searchParams.get('token');
  if (got !== expected) return new Response(JSON.stringify({ error: 'Non autorisé' }), { status: 401 });
  return null;
}
