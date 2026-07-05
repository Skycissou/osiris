// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / MAC : fabricant d'une adresse MAC (OUI).
//
//  RÔLE : renvoyer le fabricant (vendor) associé au préfixe OUI d'une adresse
//  MAC (les 3 premiers octets identifient le constructeur de l'interface).
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    https://api.macvendors.com/{q}   (renvoie le fabricant en TEXTE BRUT)
//  Fournisseur FIXE (api.macvendors.com) : la MAC n'est qu'un segment.
//
//  CADRE DÉFENSIF ARPD : la table OUI est un registre PUBLIC de l'IEEE. On ne
//  fait que traduire un préfixe matériel en nom de constructeur. Aucune donnée
//  personnelle, usage veille / enquête légale.
//
//  CONTRAT :
//    GET /osint/mac?q=<adresse MAC>
//    → 200 { mac, vendor }        (vendor: string si trouvé)
//    → 200 { mac, vendor: null }  (404 fournisseur = préfixe inconnu)
//    → 200 { mac, vendor: null, error } en cas d'échec réseau (jamais 500)
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers api.macvendors.com (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Réponse normalisée renvoyée au client. */
interface MacResult {
  mac: string | null;
  vendor: string | null;
  error?: string;
}

/**
 * Valide/normalise une adresse MAC. Accepte les séparateurs `:` `-` ou aucun,
 * de 6 à 12 chiffres hexadécimaux (préfixe OUI seul toléré). Renvoie une forme
 * canonique en majuscules séparée par `:`, ou null si invalide.
 */
function sanitizeMac(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[:\-.\s]/g, '').toUpperCase();
  // 6 hex = OUI seul (24 bits) ; 12 hex = MAC complète (48 bits).
  if (!/^[0-9A-F]{6,12}$/.test(cleaned) || cleaned.length % 2 !== 0) return null;
  // Regroupe par paires d'octets séparées par `:`.
  const pairs = cleaned.match(/.{2}/g);
  return pairs ? pairs.join(':') : null;
}

export async function GET(request: NextRequest) {
  const mac = sanitizeMac(request.nextUrl.searchParams.get('q'));
  if (!mac) {
    return NextResponse.json(
      { mac: null, vendor: null, error: 'adresse MAC invalide' } satisfies MacResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const upstream = `https://api.macvendors.com/${encodeURIComponent(mac)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'text/plain', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    // 404 = préfixe inconnu du registre : cas nominal, vendor null.
    if (res.status === 404) {
      return NextResponse.json(
        { mac, vendor: null } satisfies MacResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!res.ok) {
      // 429 (rate-limit) ou autre : dégradation douce.
      const msg = res.status === 429 ? 'quota macvendors dépassé (réessayer)' : `amont macvendors ${res.status}`;
      return NextResponse.json(
        { mac, vendor: null, error: msg } satisfies MacResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    // Réponse = fabricant en texte brut.
    const vendor = (await res.text()).trim();
    return NextResponse.json(
      { mac, vendor: vendor || null } satisfies MacResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { mac, vendor: null, error: aborted ? 'timeout macvendors' : 'échec réseau macvendors' } satisfies MacResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
