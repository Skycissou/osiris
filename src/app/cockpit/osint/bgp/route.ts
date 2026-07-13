// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / BGP : lookup réseau (IP ou ASN) via BGPView.
//
//  SOURCE : https://api.bgpview.io  — API PUBLIQUE et GRATUITE (aucune clé).
//    • q ressemble à un ASN (ASxxxx / asxxxx / xxxx sur demande explicite « AS ») →
//      https://api.bgpview.io/asn/{num}
//    • sinon on traite q comme une IP →
//      https://api.bgpview.io/ip/{q}
//
//  CONTRAT (client) :
//    GET /osint/bgp?q=<ip|ASxxxx>
//    → 200 { ip?, asn?, prefixes?, holder?, rir? }         (résultat exploitable)
//    → 200 { error: '<message>' }                          (dégradation douce)
//    Jamais de 500 : toute erreur amont/réseau/JSON devient un JSON d'erreur en 200.
//
//  CADRE ARPD : consultation de données de ROUTAGE PUBLIQUES (annonces BGP,
//  attributions RIR) déjà diffusées mondialement. Veille situationnelle
//  défensive, aucune donnée personnelle, aucun ciblage.
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : AUCUNE.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Lookup à la demande : toujours dynamique, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers BGPView (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max acceptée pour la cible (garde-fou anti-abus). */
const MAX_Q_LEN = 64;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Réponse d'erreur douce (toujours 200, no-store). */
function softError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const rawQ = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!rawQ) return softError('paramètre q requis (IP ou ASxxxx)');
  if (rawQ.length > MAX_Q_LEN) return softError('paramètre q trop long');

  // Détection ASN : « AS1234 » / « as1234 ». On n'assimile PAS un entier nu à un
  // ASN (un entier nu peut être une IP décimale ambiguë) → il faut le préfixe AS.
  const asnMatch = /^as\s*(\d{1,10})$/i.exec(rawQ);
  let upstream: string;
  if (asnMatch) {
    upstream = `https://api.bgpview.io/asn/${encodeURIComponent(asnMatch[1])}`;
  } else {
    // Traité comme IP. encodeURIComponent neutralise tout caractère de chemin.
    upstream = `https://api.bgpview.io/ip/${encodeURIComponent(rawQ)}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return softError(`amont BGPView ${res.status}`);

    const payload = (await res.json()) as {
      status?: string;
      data?: {
        // forme /ip
        ip?: string;
        rir_allocation?: { rir_name?: string };
        prefixes?: Array<{ prefix?: string; asn?: { asn?: number; name?: string; description?: string } }>;
        // forme /asn
        asn?: number;
        name?: string;
        description_short?: string;
        rir_allocation_prefix?: string;
      };
    };
    if (payload?.status !== 'ok' || !payload.data) return softError('réponse BGPView invalide');

    const d = payload.data;

    if (asnMatch) {
      // Forme ASN : holder = nom/description, rir non fourni directement ici.
      return NextResponse.json(
        {
          asn: typeof d.asn === 'number' ? `AS${d.asn}` : `AS${asnMatch[1]}`,
          holder: d.name || d.description_short || undefined,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Forme IP : on remonte l'IP, le RIR, les préfixes annonçant l'IP + le
    // holder (nom de l'ASN du 1er préfixe, le plus spécifique renvoyé en tête).
    const prefixes = Array.isArray(d.prefixes)
      ? d.prefixes.map((p) => p?.prefix).filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    const first = Array.isArray(d.prefixes) && d.prefixes.length > 0 ? d.prefixes[0] : undefined;
    const asnNum = first?.asn?.asn;

    return NextResponse.json(
      {
        ip: d.ip || rawQ,
        asn: typeof asnNum === 'number' ? `AS${asnNum}` : undefined,
        prefixes: prefixes.length ? prefixes : undefined,
        holder: first?.asn?.name || first?.asn?.description || undefined,
        rir: d.rir_allocation?.rir_name || undefined,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout BGPView' : 'échec réseau BGPView');
  } finally {
    clearTimeout(timeout);
  }
}
