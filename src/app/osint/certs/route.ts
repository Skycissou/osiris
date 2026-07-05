// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / CERTS : Certificate Transparency (crt.sh).
//
//  RÔLE : lister les certificats TLS émis pour un domaine (et ses
//  sous-domaines), via les logs publics de Certificate Transparency. Outil
//  classique de reconnaissance de surface d'attaque / découverte de
//  sous-domaines.
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    https://crt.sh/?q={q}&output=json
//  Fournisseur FIXE (crt.sh) : le domaine n'est qu'un paramètre de requête.
//
//  CADRE DÉFENSIF ARPD : les logs CT sont PUBLICS et append-only par
//  conception (chaque certificat émis y est journalisé). On ne fait qu'agréger
//  ce registre ouvert. Usage veille / enquête légale, aucun ciblage abusif.
//
//  CONTRAT :
//    GET /osint/certs?q=<domaine>
//    → 200 { certs: { id, name_value, issuer, not_before, not_after }[] }
//      (dédupliqué, limité à ~100 entrées les plus récentes)
//    → 200 { certs: [], error: 'message FR' } en cas d'échec (jamais 500)
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers crt.sh (ms) — la base CT peut être lente. */
const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max acceptée pour la cible. */
const MAX_Q_LEN = 253;
/** Plafond d'entrées renvoyées au client. */
const MAX_CERTS = 100;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Un certificat normalisé renvoyé au client. */
interface CertEntry {
  id: number | string;
  name_value: string;
  issuer: string;
  not_before: string;
  not_after: string;
}

/**
 * Sanitize le domaine. Autorise le wildcard de recherche `%` en tête/queue
 * (usage crt.sh courant, ex. `%.exemple.com`) en plus des caractères de FQDN.
 */
function sanitizeDomain(raw: string | null): string | null {
  if (!raw) return null;
  const q = raw.trim().toLowerCase();
  if (!q || q.length > MAX_Q_LEN) return null;
  // Lettres, chiffres, tirets, points, plus `%` et `_` (jokers SQL de crt.sh).
  if (!/^[a-z0-9%_.-]+$/.test(q)) return null;
  // Doit contenir au moins un point (un vrai domaine, pas un mot seul).
  if (!q.includes('.')) return null;
  return q;
}

export async function GET(request: NextRequest) {
  const domain = sanitizeDomain(request.nextUrl.searchParams.get('q'));
  if (!domain) {
    return NextResponse.json(
      { certs: [], error: 'domaine invalide' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const upstream = `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`;
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
        { certs: [], error: `amont crt.sh ${res.status}` },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const text = await res.text();
    // crt.sh renvoie parfois un corps vide (aucun certificat) → liste vide.
    if (!text.trim()) {
      return NextResponse.json(
        { certs: [] },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { certs: [], error: 'réponse crt.sh illisible' },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { certs: [] },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // Normalise + déduplique par id de certificat, tri du plus récent au plus
    // ancien (not_before décroissant), plafonné à MAX_CERTS.
    const seen = new Set<string>();
    const entries: CertEntry[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const id = typeof o.id === 'number' || typeof o.id === 'string' ? o.id : '';
      const key = String(id);
      if (id !== '' && seen.has(key)) continue;
      if (id !== '') seen.add(key);
      entries.push({
        id,
        name_value: typeof o.name_value === 'string' ? o.name_value : '',
        issuer: typeof o.issuer_name === 'string' ? o.issuer_name : '',
        not_before: typeof o.not_before === 'string' ? o.not_before : '',
        not_after: typeof o.not_after === 'string' ? o.not_after : '',
      });
    }
    entries.sort((a, b) => (b.not_before > a.not_before ? 1 : b.not_before < a.not_before ? -1 : 0));

    return NextResponse.json(
      { certs: entries.slice(0, MAX_CERTS) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { certs: [], error: aborted ? 'timeout crt.sh' : 'échec réseau crt.sh' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
