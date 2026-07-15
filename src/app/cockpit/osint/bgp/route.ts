// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / BGP : lookup réseau (IP ou ASN) via RIPEstat.
//
//  SOURCE : https://stat.ripe.net/data/…  — API PUBLIQUE et GRATUITE (aucune clé).
//    • IP  →  data/network-info/data.json?resource={ip}   → { prefix, asns[] }
//    • ASN →  data/as-overview/data.json?resource=AS{n}   → { holder, block }
//      (+ data/announced-prefixes pour la liste des préfixes annoncés)
//    Remplace api.bgpview.io (domaine MORT / NXDOMAIN mondial au 2026-07-15).
//
//  CONTRAT (client — INCHANGÉ, calé sur <OsintPanel> case 'bgp') :
//    GET /osint/bgp?q=<ip|ASxxxx>
//    → 200 { ip?, asn?, prefixes?, holder?, rir? }         (résultat exploitable)
//    → 200 { error: '<message>' }                          (dégradation douce)
//    Jamais de 500 : toute erreur amont/réseau/JSON devient un JSON d'erreur en 200.
//
//  CADRE ARPD : consultation de données de ROUTAGE PUBLIQUES (annonces BGP,
//  attributions RIR) déjà diffusées mondialement. Veille situationnelle
//  défensive, aucune donnée personnelle, aucun ciblage.
//
//  Ré-écriture clean-room (calque : src/app/cockpit/osint/ip/route.ts).
//  Clé env : AUCUNE.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { safeFetch } from '@/lib/ssrf-guard';

// Lookup à la demande : toujours dynamique, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers RIPEstat (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max acceptée pour la cible (garde-fou anti-abus). */
const MAX_Q_LEN = 64;
/** Nombre max de préfixes remontés pour un ASN (garde-fou : certains en annoncent des milliers). */
const MAX_PREFIXES = 25;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Réponse d'erreur douce (toujours 200, no-store). */
function softError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

function ok(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

/** GET JSON RIPEstat avec timeout + SSRF guard. Renvoie `data` (objet) ou null. */
async function ripeData(path: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(`https://stat.ripe.net/data/${path}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    return json && typeof json.data === 'object' && json.data !== null
      ? (json.data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Déduit le RIR d'un libellé de bloc RIPEstat (ex. « RIPE NCC ASN block »). */
function rirFromBlockDesc(desc: unknown): string | undefined {
  const s = typeof desc === 'string' ? desc.toUpperCase() : '';
  const m = /(RIPE|ARIN|APNIC|LACNIC|AFRINIC)/.exec(s);
  return m ? m[1] : undefined;
}

/** Récupère holder + RIR d'un ASN via as-overview (best-effort). */
async function asnOverview(asn: string): Promise<{ holder?: string; rir?: string }> {
  const d = await ripeData(`as-overview/data.json?resource=AS${encodeURIComponent(asn)}`);
  if (!d) return {};
  const block = d.block && typeof d.block === 'object' ? (d.block as Record<string, unknown>) : {};
  return { holder: str(d.holder), rir: rirFromBlockDesc(block.desc) };
}

export async function GET(request: NextRequest) {
  const rawQ = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!rawQ) return softError('paramètre q requis (IP ou ASxxxx)');
  if (rawQ.length > MAX_Q_LEN) return softError('paramètre q trop long');

  // Détection ASN : « AS1234 » / « as1234 ». On n'assimile PAS un entier nu à un
  // ASN (un entier nu peut être une IP décimale ambiguë) → il faut le préfixe AS.
  const asnMatch = /^as\s*(\d{1,10})$/i.exec(rawQ);

  // ── Forme ASN ───────────────────────────────────────────────────────────────
  if (asnMatch) {
    const asnNum = asnMatch[1];
    const { holder, rir } = await asnOverview(asnNum);
    if (holder === undefined && rir === undefined) {
      return softError('ASN introuvable ou amont RIPEstat indisponible');
    }

    // Préfixes annoncés (best-effort, borné) — enrichit le panneau sans le casser.
    let prefixes: string[] | undefined;
    const ann = await ripeData(`announced-prefixes/data.json?resource=AS${encodeURIComponent(asnNum)}`);
    const rawPrefixes = ann && Array.isArray(ann.prefixes) ? ann.prefixes : [];
    const list = rawPrefixes
      .map((p) => (p && typeof p === 'object' ? str((p as Record<string, unknown>).prefix) : undefined))
      .filter((p): p is string => !!p)
      .slice(0, MAX_PREFIXES);
    if (list.length) prefixes = list;

    return ok({
      asn: `AS${asnNum}`,
      holder: holder ?? undefined,
      rir: rir ?? undefined,
      prefixes,
    });
  }

  // ── Forme IP ─────────────────────────────────────────────────────────────────
  if (isIP(rawQ) === 0) return softError('IP ou ASN (ASxxxx) requis');

  const netInfo = await ripeData(`network-info/data.json?resource=${encodeURIComponent(rawQ)}`);
  if (!netInfo) return softError('amont RIPEstat indisponible');

  const prefix = str(netInfo.prefix);
  const asns = Array.isArray(netInfo.asns)
    ? netInfo.asns.map((a) => (typeof a === 'string' || typeof a === 'number' ? String(a) : '')).filter(Boolean)
    : [];

  if (!prefix && asns.length === 0) {
    return softError('IP non routée / absente des tables BGP');
  }

  // Le 1er ASN est celui qui annonce le préfixe le plus spécifique → holder/RIR.
  const primaryAsn = asns[0];
  const overview = primaryAsn ? await asnOverview(primaryAsn) : {};

  return ok({
    ip: rawQ,
    asn: primaryAsn ? `AS${primaryAsn}` : undefined,
    prefixes: prefix ? [prefix] : undefined,
    holder: overview.holder ?? undefined,
    rir: overview.rir ?? undefined,
  });
}
