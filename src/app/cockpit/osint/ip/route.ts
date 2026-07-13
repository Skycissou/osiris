// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / IP : géolocalisation + ASN d'une adresse IP.
//
//  RÔLE : renvoyer la géoloc approximative (pays/ville/lat/lng) et les infos
//  réseau (ASN, organisation, FAI) d'une adresse IP publique.
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    https://ipwho.is/{q}   (HTTPS, gratuit, sans inscription)
//  Fournisseur FIXE (ipwho.is) : la cible n'est qu'un segment de chemin.
//
//  CADRE DÉFENSIF ARPD : géoloc IP = donnée réseau publique et APPROXIMATIVE
//  (précision ville, jamais adresse postale). Usage veille / enquête légale,
//  aucune prétention d'identifier une personne physique. Pas de ciblage abusif.
//
//  CONTRAT :
//    GET /osint/ip?q=<ip>
//    → 200 { ip, country, city, lat, lng, asn, org, isp }
//    → 200 { error: 'message FR', ip } en cas d'échec (jamais 500)
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers ipwho.is (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Réponse normalisée renvoyée au client. */
interface IpResult {
  ip: string | null;
  country?: string;
  city?: string;
  lat?: number;
  lng?: number;
  asn?: string;
  org?: string;
  isp?: string;
  error?: string;
}

/** Valide la cible : uniquement une IP littérale v4/v6. */
function sanitizeIp(raw: string | null): string | null {
  if (!raw) return null;
  const q = raw.trim();
  if (isIP(q) === 0) return null; // ni IPv4 ni IPv6 valide
  return q;
}

export async function GET(request: NextRequest) {
  const ip = sanitizeIp(request.nextUrl.searchParams.get('q'));
  if (!ip) {
    return NextResponse.json(
      { ip: null, error: 'adresse IP invalide' } satisfies IpResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const upstream = `https://ipwho.is/${encodeURIComponent(ip)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) {
      return NextResponse.json(
        { ip, error: `amont ipwho.is ${res.status}` } satisfies IpResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const data = (await res.json()) as Record<string, unknown>;

    // ipwho.is renvoie { success:false, message } sur cible invalide/rate-limit.
    if (data.success === false) {
      const msg = typeof data.message === 'string' ? data.message : 'requête refusée par ipwho.is';
      return NextResponse.json(
        { ip, error: msg } satisfies IpResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const conn = (data.connection && typeof data.connection === 'object'
      ? (data.connection as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) ? v : undefined;

    const asnRaw = conn.asn;
    const result: IpResult = {
      ip: str(data.ip) ?? ip,
      country: str(data.country),
      city: str(data.city),
      lat: num(data.latitude),
      lng: num(data.longitude),
      asn: asnRaw !== undefined && asnRaw !== null ? `AS${String(asnRaw)}` : undefined,
      org: str(conn.org) ?? str(conn.domain),
      isp: str(conn.isp),
    };
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { ip, error: aborted ? 'timeout ipwho.is' : 'échec réseau ipwho.is' } satisfies IpResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
