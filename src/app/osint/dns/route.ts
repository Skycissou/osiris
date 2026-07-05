// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / DNS : résolution DNS-over-HTTPS (DoH).
//
//  RÔLE : résoudre les enregistrements DNS publics d'un nom de domaine
//  (A, AAAA, MX, TXT, NS) via le résolveur DoH de Google.
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    https://dns.google/resolve?name={q}&type={type}
//  Fournisseur FIXE (dns.google) : la cible utilisateur n'est qu'un paramètre
//  de requête, jamais une URL fetchée directement.
//
//  CADRE DÉFENSIF ARPD : le DNS est une donnée publique par nature (annuaire
//  ouvert d'Internet). Usage veille / enquête légale. Aucun ciblage abusif.
//
//  CONTRAT :
//    GET /osint/dns?q=<domaine>&type=<A|AAAA|MX|TXT|NS>   (type optionnel)
//    Sans `type` → résout les 5 types courants (A, AAAA, MX, TXT, NS).
//    → 200 { records: { type, value, ttl }[] }
//    → 200 { records: [], error: 'message FR' } en cas d'échec (jamais 500)
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers dns.google (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max acceptée pour la cible. */
const MAX_Q_LEN = 253;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';
/** Types résolus par défaut si le client n'en précise pas. */
const DEFAULT_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS'] as const;
/** Types DNS autorisés (liste blanche → aucune injection de type exotique). */
const ALLOWED_TYPES = new Set<string>(['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV']);

/** Un enregistrement DNS normalisé. */
interface DnsRecord {
  type: string;
  value: string;
  ttl?: number;
}

/** Mapping code numérique DNS (RRTYPE) → libellé, pour la réponse Google DoH. */
const TYPE_BY_CODE: Record<number, string> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  257: 'CAA',
};

/** Sanitize le nom de domaine (caractères stricts, pas de schéma ni chemin). */
function sanitizeName(raw: string | null): string | null {
  if (!raw) return null;
  const q = raw.trim().toLowerCase();
  if (!q || q.length > MAX_Q_LEN) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(q)) return null;
  return q;
}

/**
 * Interroge Google DoH pour UN type. Renvoie les enregistrements normalisés.
 * Ne jette jamais : toute erreur → [] (le handler agrège ce qui a réussi).
 */
async function resolveType(name: string, type: string): Promise<DnsRecord[]> {
  const upstream = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/dns-json, application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { Answer?: Array<{ type?: number; data?: string; TTL?: number }> };
    if (!Array.isArray(data.Answer)) return [];
    const out: DnsRecord[] = [];
    for (const ans of data.Answer) {
      if (typeof ans.data !== 'string') continue;
      const label = typeof ans.type === 'number' ? (TYPE_BY_CODE[ans.type] ?? type) : type;
      out.push({
        type: label,
        value: ans.data,
        ttl: typeof ans.TTL === 'number' && Number.isFinite(ans.TTL) ? ans.TTL : undefined,
      });
    }
    return out;
  } catch {
    return []; // timeout / réseau / JSON invalide → agrégé comme vide
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const name = sanitizeName(request.nextUrl.searchParams.get('q'));
  if (!name) {
    return NextResponse.json(
      { records: [], error: 'domaine invalide' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Sélection des types : param `?type=` (validé) sinon les 5 par défaut.
  const typeParam = request.nextUrl.searchParams.get('type');
  let types: string[];
  if (typeParam) {
    const t = typeParam.trim().toUpperCase();
    if (!ALLOWED_TYPES.has(t)) {
      return NextResponse.json(
        { records: [], error: `type DNS non supporté : ${t}` },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    types = [t];
  } else {
    types = [...DEFAULT_TYPES];
  }

  // Résolution en parallèle des types demandés (chacun dégrade en douceur).
  const groups = await Promise.all(types.map((t) => resolveType(name, t)));
  const records = groups.flat();

  return NextResponse.json(
    { records },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
