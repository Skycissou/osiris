// ─────────────────────────────────────────────────────────────────────────────
//  GET /cockpit/alerts/photo?u=<url> — Proxy image « Alertes disparitions »
//
//  Pourquoi : certaines sources (Interpol, 116000…) protègent leurs photos
//  (referer/hotlink) ou les servent en http → l'<img> direct casse. Ce proxy
//  RE-SERT l'image same-origin en HTTPS pour qu'elle s'affiche quoi qu'il arrive.
//
//  RGPD §6 — « JAMAIS stockée localement » : STREAMING PUR, aucune écriture
//  disque, aucun cache serveur. L'image transite en mémoire le temps d'une
//  requête (déclenchée uniquement au clic sur une fiche), puis disparaît. C'est
//  toujours du hotlink — juste routé pour défaire la protection amont.
//
//  Sécurité :
//   • http/https uniquement ; taille & timeout bornés ; content-type image/* only.
//   • ANTI-SSRF : résolution DNS + refus des IP privées/loopback/link-local/CGNAT
//     et de l'endpoint métadonnées cloud (169.254.169.254). Pas d'accès interne.
//
//  ⚠️ Sous /cockpit (basePath) — PAS /api/* (Traefik strippe /api → V3 FastAPI).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BYTES = 4 * 1024 * 1024; // 4 Mo — une photo de fiche, large
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** IP privée / loopback / link-local / CGNAT / métadonnées cloud → refus SSRF. */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true; // this-net, privé, loopback
    if (a === 169 && b === 254) return true; // link-local + métadonnées cloud
    if (a === 172 && b >= 16 && b <= 31) return true; // privé
    if (a === 192 && b === 168) return true; // privé
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/réservé
    return false;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (s === '::1' || s === '::') return true; // loopback / unspecified
    if (s.startsWith('fe80') || s.startsWith('fc') || s.startsWith('fd')) return true; // link-local / ULA
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // ni v4 ni v6 → refus
}

/** Refuse un hostname dont TOUTES les résolutions ne sont pas publiques. */
async function assertPublicHost(hostname: string): Promise<void> {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    throw new Error('host interdit');
  }
  if (isIP(h)) {
    if (isPrivateIp(h)) throw new Error('IP privée interdite');
    return;
  }
  const addrs = await lookup(h, { all: true });
  if (!addrs.length) throw new Error('DNS vide');
  for (const a of addrs) if (isPrivateIp(a.address)) throw new Error('résout vers IP privée');
}

/** Valide une URL candidate (protocole + host public). Renvoie l'URL ou lève. */
async function validated(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL invalide');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocole interdit');
  await assertPublicHost(u.hostname);
  return u;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('u');
  if (!raw || raw.length > 1000) return NextResponse.json({ error: 'u requis' }, { status: 400 });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Suivi manuel des redirections : chaque saut est re-validé (anti-SSRF via redirect).
    let current = await validated(raw);
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'image/*', 'User-Agent': 'OSIRIS-cockpit/photo-proxy' },
        // Pas de referer : on ne fuite pas l'origine cockpit vers la source.
        referrerPolicy: 'no-referrer',
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error('redirection sans Location');
        current = await validated(new URL(loc, current).toString());
        continue;
      }
      break;
    }
    if (!res || !res.ok) return NextResponse.json({ error: 'amont', status: res?.status ?? 0 }, { status: 502 });

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return NextResponse.json({ error: 'pas une image' }, { status: 415 });

    const len = Number(res.headers.get('content-length') || '0');
    if (len && len > MAX_BYTES) return NextResponse.json({ error: 'trop volumineux' }, { status: 413 });

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'trop volumineux' }, { status: 413 });

    // no-store : aucun cache serveur/CDN. Le navigateur peut garder brièvement.
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Content-Length': String(buf.byteLength),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erreur';
    const aborted = msg.includes('abort');
    return NextResponse.json({ error: aborted ? 'timeout' : msg }, { status: aborted ? 504 : 400 });
  } finally {
    clearTimeout(timer);
  }
}
