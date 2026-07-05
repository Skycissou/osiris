// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / CVE : détail d'une vulnérabilité publique.
//
//  RÔLE : renvoyer le résumé et les métadonnées d'une CVE (Common
//  Vulnerabilities and Exposures) à partir de son identifiant.
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    https://cve.circl.lu/api/cve/{q}   (CIRCL, CERT luxembourgeois)
//  Fournisseur FIXE (cve.circl.lu) : l'identifiant CVE n'est qu'un segment.
//
//  CADRE DÉFENSIF ARPD : les CVE sont des informations de sécurité PUBLIQUES
//  et normalisées, destinées à la défense (patch management, veille). Usage
//  strictement défensif / veille légale.
//
//  CONTRAT :
//    GET /osint/cve?q=CVE-XXXX-XXXXX
//    → 200 { id, summary, cvss?, published?, modified?, references? }
//    → 200 { id, error: 'message FR' } en cas d'échec / introuvable (jamais 500)
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers cve.circl.lu (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** User-Agent identifiant l'appelant. */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Réponse normalisée renvoyée au client. */
interface CveResult {
  id: string | null;
  summary?: string;
  cvss?: number;
  published?: string;
  modified?: string;
  references?: string[];
  error?: string;
}

/**
 * Valide/normalise l'identifiant CVE (format CVE-AAAA-NNNN+, insensible à la
 * casse). Renvoie la forme canonique majuscule, ou null si invalide.
 */
function sanitizeCve(raw: string | null): string | null {
  if (!raw) return null;
  const q = raw.trim().toUpperCase();
  if (!/^CVE-\d{4}-\d{4,19}$/.test(q)) return null;
  return q;
}

/**
 * Cherche récursivement un score CVSS de base dans un payload CIRCL au schéma
 * variable (cvss, cvss3, metrics.cvssMetricVXX[].cvssData.baseScore…). Renvoie
 * le premier nombre plausible (0..10) trouvé, sinon undefined.
 */
function extractCvss(data: Record<string, unknown>): number | undefined {
  const direct = data.cvss;
  if (typeof direct === 'number' && direct >= 0 && direct <= 10) return direct;
  if (typeof direct === 'string') {
    const n = Number(direct);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  }
  // Schéma NVD-like éventuellement relayé par CIRCL.
  const containers = data.containers;
  if (containers && typeof containers === 'object') {
    const found = deepFindBaseScore(containers);
    if (found !== undefined) return found;
  }
  const metrics = data.metrics;
  if (metrics !== undefined) {
    const found = deepFindBaseScore(metrics);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Descente récursive bornée à la recherche d'une clé baseScore numérique. */
function deepFindBaseScore(node: unknown, depth = 0): number | undefined {
  if (depth > 6 || node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = deepFindBaseScore(item, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const o = node as Record<string, unknown>;
  const bs = o.baseScore;
  if (typeof bs === 'number' && bs >= 0 && bs <= 10) return bs;
  if (typeof bs === 'string') {
    const n = Number(bs);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  }
  for (const v of Object.values(o)) {
    const r = deepFindBaseScore(v, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** Récupère un tableau de références (URLs) au format tolérant. */
function extractReferences(data: Record<string, unknown>): string[] | undefined {
  const refs = data.references;
  const out: string[] = [];
  if (Array.isArray(refs)) {
    for (const r of refs) {
      if (typeof r === 'string') out.push(r);
      else if (r && typeof r === 'object') {
        const url = (r as Record<string, unknown>).url;
        if (typeof url === 'string') out.push(url);
      }
    }
  }
  return out.length ? out.slice(0, 50) : undefined;
}

export async function GET(request: NextRequest) {
  const id = sanitizeCve(request.nextUrl.searchParams.get('q'));
  if (!id) {
    return NextResponse.json(
      { id: null, error: 'identifiant CVE invalide (format CVE-AAAA-NNNN attendu)' } satisfies CveResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const upstream = `https://cve.circl.lu/api/cve/${encodeURIComponent(id)}`;
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
      const msg = res.status === 404 ? 'CVE introuvable' : `amont CIRCL ${res.status}`;
      return NextResponse.json(
        { id, error: msg } satisfies CveResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    // CIRCL renvoie `null` (ou corps vide) quand la CVE n'existe pas.
    const text = await res.text();
    if (!text || text.trim() === 'null') {
      return NextResponse.json(
        { id, error: 'CVE introuvable' } satisfies CveResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { id, error: 'réponse CIRCL illisible' } satisfies CveResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const result: CveResult = {
      id: str(data.id) ?? id,
      summary: str(data.summary),
      cvss: extractCvss(data),
      published: str(data.Published) ?? str(data.published) ?? str(data.datePublished),
      modified: str(data.Modified) ?? str(data.modified) ?? str(data.dateUpdated),
      references: extractReferences(data),
    };
    return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return NextResponse.json(
      { id, error: aborted ? 'timeout CIRCL' : 'échec réseau CIRCL' } satisfies CveResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
