// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / LEAKS : fuites de données associées à un compte (email).
//
//  SOURCE : https://haveibeenpwned.com/api/v3  — CLÉ REQUISE (HIBP_KEY).
//    • https://haveibeenpwned.com/api/v3/breachedaccount/{q}?truncateResponse=false
//      en-têtes : `hibp-api-key: {HIBP_KEY}` + `user-agent` (exigé par HIBP).
//  Renvoie la liste des BRÈCHES connues où l'adresse a été exposée.
//
//  DÉGRADATION DOUCE / CLÉ ABSENTE : si HIBP_KEY n'est pas configurée, on renvoie
//  { error:'clé HIBP requise' } en 200 SANS AUCUN appel réseau (règle d'or).
//
//  CONTRAT (client) :
//    GET /osint/leaks?q=<email>
//    → 200 { breaches: { Name, Domain?, BreachDate? }[] }  (résultat ; [] si aucune)
//    → 200 { error: '<message>' }                          (clé absente / amont KO)
//    Jamais de 500.
//
//  ⚠️ CADRE ARPD — USAGE STRICTEMENT LÉGAL / CONSENTI : la recherche de fuites
//  sur une adresse email ne se justifie que sur SA PROPRE adresse, une adresse
//  pour laquelle on a le consentement du titulaire, ou dans un cadre d'enquête
//  autorisé. Ce n'est PAS un outil de profilage de tiers. Aucune donnée n'est
//  stockée par cette route (proxy à la demande, no-store).
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : HIBP_KEY (REQUISE).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_Q_LEN = 254; // longueur max d'une adresse email (RFC 5321)
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

function softError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Clé effective d'un service. Priorité à l'en-tête HTTP fourni par l'utilisateur
 * (`x-osiris-key-<service>`) — Cissou peut ainsi renseigner sa clé depuis l'app
 * sans redéployer — sinon repli sur la variable d'env. '' si ni l'un ni l'autre
 * (dégradation douce inchangée : la route reste vide, jamais un 500).
 */
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) || (env ? process.env[env] : undefined) || '';

interface RawBreach {
  Name?: string;
  Domain?: string;
  BreachDate?: string;
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return softError('paramètre q requis (email)');
  if (q.length > MAX_Q_LEN) return softError('paramètre q trop long');
  // Validation email basique : évite d'envoyer n'importe quoi à HIBP et bloque
  // le path traversal (l'@ + le domaine sont attendus).
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return softError('adresse email invalide');

  // Clé effective : en-tête user `x-osiris-key-hibp` OU env HIBP_KEY (voir keyOf).
  // Règle d'or : sans aucune clé, AUCUN appel réseau.
  const key = keyOf(request, 'hibp', 'HIBP_KEY');
  if (!key) return softError('clé HIBP requise');

  const url = `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(q)}?truncateResponse=false`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'hibp-api-key': key,
        // HIBP EXIGE un user-agent descriptif, sinon 403.
        'User-Agent': USER_AGENT,
      },
      maxRedirects: 2,
    });
    // 404 = compte présent dans AUCUNE brèche connue → résultat légitime, vide.
    if (res.status === 404) {
      return NextResponse.json({ breaches: [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    if (res.status === 401) return softError('clé HIBP invalide');
    if (res.status === 429) return softError('quota HIBP atteint (rate-limit)');
    if (!res.ok) return softError(`amont HIBP ${res.status}`);

    const payload = (await res.json()) as RawBreach[];
    const breaches = Array.isArray(payload)
      ? payload
          .filter((b) => b && typeof b.Name === 'string')
          .map((b) => ({
            Name: b.Name as string,
            Domain: b.Domain || undefined,
            BreachDate: b.BreachDate || undefined,
          }))
      : [];

    return NextResponse.json({ breaches }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout HIBP' : 'échec réseau HIBP');
  } finally {
    clearTimeout(timeout);
  }
}
