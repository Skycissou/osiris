// ─────────────────────────────────────────────────────────────────────────────
//  diagAuth.ts — Garde token pour les endpoints de diag sensibles (serveur only)
//  Spec Claude 07/07 (§6). Token = env OSIRIS_DIAG_TOKEN, comparé à
//  l'en-tête x-diag-token ou ?token=. SÉCURISÉ PAR DÉFAUT : token non défini →
//  403 en production (staging tourne sans login V3 sur /cockpit).
// ─────────────────────────────────────────────────────────────────────────────

import type { NextRequest } from 'next/server';

/** true si la requête est autorisée à lire les diags sensibles. */
export function diagAuthorized(req: NextRequest): boolean {
  const expected = (process.env.OSIRIS_DIAG_TOKEN || '').trim();
  if (!expected) {
    // Pas de token configuré → ouvert seulement en dev, fermé en prod.
    return process.env.NODE_ENV === 'development';
  }
  const provided = (req.headers.get('x-diag-token') || req.nextUrl.searchParams.get('token') || '').trim();
  return provided.length > 0 && provided === expected;
}
