// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / SHODAN : empreinte réseau d'une IP (ports, services, CVE).
//
//  SOURCE PRIMAIRE : https://internetdb.shodan.io/{ip}
//    • GRATUITE, SANS CLÉ, sans inscription. Renvoie la surface publique déjà
//      scannée par Shodan : ports ouverts, hostnames, CVE (vulns), tags, cpes.
//    • N'accepte QUE des adresses IP (v4/v6) — jamais un domaine.
//
//  ENRICHISSEMENT OPTIONNEL : https://api.shodan.io/shodan/host/{ip}?key=…
//    • Uniquement SI une clé est fournie (en-tête x-osiris-key-shodan ou env
//      SHODAN_KEY) ET si l'appel renvoie 200. On merge alors org / os / isp.
//    • Le plan gratuit « oss » renvoie 403 « Requires membership » sur cet
//      endpoint : 401/403/timeout/erreur → IGNORÉS SILENCIEUSEMENT. L'absence
//      ou l'échec de l'enrichissement ne casse JAMAIS le résultat InternetDB.
//
//  CONTRAT (client) :
//    GET /osint/shodan?q=<ip>
//    → 200 { ip, ports?, hostnames?, vulns?, tags?, cpes?, org?, os?, isp? }
//    → 200 { error: '<message>' }   (q non-IP / IP absente / amont KO)
//    Jamais de 500.
//
//  CADRE ARPD : la donnée Shodan est de la SURFACE PUBLIQUE déjà scannée et
//  diffusée. Consultation défensive (cartographie d'exposition), pas d'intrusion,
//  aucune donnée personnelle.
//
//  Ré-écriture clean-room (calque : src/app/cockpit/osint/ip/route.ts).
//  Clé env : SHODAN_KEY (OPTIONNELLE — enrichissement seulement).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
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
 * sans redéployer — sinon repli sur la variable d'env. '' si ni l'un ni l'autre.
 */
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) || (env ? process.env[env] : undefined) || '';

/** Forme brute renvoyée par InternetDB. */
interface RawInternetDb {
  ip?: string;
  ports?: number[];
  hostnames?: string[];
  vulns?: string[];
  tags?: string[];
  cpes?: string[];
}

/** Forme (partielle) renvoyée par l'API Shodan payante — enrichissement. */
interface RawShodanHost {
  org?: string;
  os?: string | null;
  isp?: string;
}

/** Résultat normalisé renvoyé au client (compatible <OsintPanel> case 'shodan'). */
interface ShodanResult {
  ip: string;
  ports?: number[];
  hostnames?: string[];
  vulns?: string[];
  tags?: string[];
  cpes?: string[];
  org?: string;
  os?: string;
  isp?: string;
}

const strList = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return out.length ? out : undefined;
};

const numList = (v: unknown): number[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return out.length ? out : undefined;
};

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return softError('paramètre q requis (IP)');
  if (q.length > MAX_Q_LEN) return softError('paramètre q trop long');
  // InternetDB n'accepte QUE des IP littérales (jamais un domaine).
  if (isIP(q) === 0) return softError('IP requise (InternetDB n’accepte que des adresses IP)');

  // ── Source primaire : InternetDB (gratuit, sans clé) ────────────────────────
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let result: ShodanResult;
  try {
    const res = await safeFetch(`https://internetdb.shodan.io/${encodeURIComponent(q)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    // 404 = IP inconnue de Shodan (jamais scannée) → résultat « vide » explicite.
    if (res.status === 404) return softError('IP absente de Shodan (aucune info)');
    if (!res.ok) return softError(`amont InternetDB ${res.status}`);

    const h = (await res.json()) as RawInternetDb;
    result = {
      ip: (typeof h.ip === 'string' && h.ip) || q,
      ports: numList(h.ports),
      hostnames: strList(h.hostnames),
      vulns: strList(h.vulns),
      tags: strList(h.tags),
      cpes: strList(h.cpes),
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout InternetDB' : 'échec réseau InternetDB');
  } finally {
    clearTimeout(timeout);
  }

  // ── Enrichissement OPTIONNEL : API Shodan payante (best-effort) ──────────────
  // Uniquement si une clé est présente. TOUTE erreur (401/403 plan « oss »,
  // timeout, JSON illisible…) est avalée : le résultat InternetDB reste intact.
  const key = keyOf(request, 'shodan', 'SHODAN_KEY');
  if (key) {
    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(q)}?key=${encodeURIComponent(key)}`;
      const res2 = await safeFetch(url, {
        method: 'GET',
        signal: c2.signal,
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        maxRedirects: 2,
      });
      if (res2.ok) {
        const eh = (await res2.json()) as RawShodanHost;
        if (typeof eh.org === 'string' && eh.org) result.org = eh.org;
        if (typeof eh.os === 'string' && eh.os) result.os = eh.os;
        if (typeof eh.isp === 'string' && eh.isp) result.isp = eh.isp;
      }
      // res2 non-ok (403 « Requires membership », 401…) → ignoré silencieusement.
    } catch {
      // timeout / réseau / JSON → ignoré : l'enrichissement est purement bonus.
    } finally {
      clearTimeout(t2);
    }
  }

  return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
