// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / SHODAN : empreinte réseau d'une IP (ports, services…).
//
//  SOURCE : https://api.shodan.io  — CLÉ REQUISE (SHODAN_KEY).
//    • https://api.shodan.io/shodan/host/{q}?key={SHODAN_KEY}
//  Shodan scanne l'Internet et expose la surface d'attaque publique d'une IP :
//  ports ouverts, bannières de services, hostnames, OS deviné, CVE associées.
//
//  DÉGRADATION DOUCE / CLÉ ABSENTE : si SHODAN_KEY n'est pas configurée, on
//  renvoie { error:'clé SHODAN requise' } en 200 SANS AUCUN appel réseau
//  (règle d'or : pas de fetch sans clé).
//
//  CONTRAT (client) :
//    GET /osint/shodan?q=<ip>
//    → 200 { ip, ports?, hostnames?, org?, os?, vulns? }   (résultat)
//    → 200 { error: '<message>' }                          (clé absente / amont KO)
//    Jamais de 500.
//
//  CADRE ARPD : la donnée Shodan est de la SURFACE PUBLIQUE déjà scannée et
//  diffusée. Consultation défensive (cartographie d'exposition), pas d'intrusion,
//  aucune donnée personnelle.
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : SHODAN_KEY (REQUISE).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_Q_LEN = 64;
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

interface RawHost {
  ip_str?: string;
  ports?: number[];
  hostnames?: string[];
  org?: string;
  os?: string | null;
  vulns?: string[] | Record<string, unknown>;
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return softError('paramètre q requis (IP)');
  if (q.length > MAX_Q_LEN) return softError('paramètre q trop long');

  // Clé effective : en-tête user `x-osiris-key-shodan` OU env SHODAN_KEY (voir
  // keyOf). Règle d'or : sans aucune clé, AUCUN appel réseau.
  const key = keyOf(request, 'shodan', 'SHODAN_KEY');
  if (!key) return softError('clé SHODAN requise');

  const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(q)}?key=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (res.status === 401) return softError('clé SHODAN invalide');
    if (res.status === 404) return softError('IP absente de Shodan (aucune info)');
    if (!res.ok) return softError(`amont Shodan ${res.status}`);

    const h = (await res.json()) as RawHost;

    // vulns peut arriver en tableau ou en objet (clés = CVE) selon le plan.
    let vulns: string[] | undefined;
    if (Array.isArray(h.vulns)) {
      vulns = h.vulns.filter((v): v is string => typeof v === 'string');
    } else if (h.vulns && typeof h.vulns === 'object') {
      vulns = Object.keys(h.vulns);
    }

    return NextResponse.json(
      {
        ip: h.ip_str || q,
        ports: Array.isArray(h.ports) && h.ports.length ? h.ports : undefined,
        hostnames: Array.isArray(h.hostnames) && h.hostnames.length ? h.hostnames : undefined,
        org: h.org || undefined,
        os: h.os || undefined,
        vulns: vulns && vulns.length ? vulns : undefined,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout Shodan' : 'échec réseau Shodan');
  } finally {
    clearTimeout(timeout);
  }
}
