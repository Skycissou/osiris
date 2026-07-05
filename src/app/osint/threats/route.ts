// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / THREATS : réputation d'abus d'une IP (AbuseIPDB).
//
//  SOURCE : https://api.abuseipdb.com/api/v2  — CLÉ REQUISE (ABUSEIPDB_KEY).
//    • https://api.abuseipdb.com/api/v2/check?ipAddress={q}&maxAgeInDays=90
//      en-tête : `Key: {ABUSEIPDB_KEY}` + `Accept: application/json`.
//  AbuseIPDB agrège les signalements d'IP malveillantes (scans, brute-force,
//  spam…) et renvoie un score de confiance d'abus 0-100.
//
//  DÉGRADATION DOUCE / CLÉ ABSENTE : si ABUSEIPDB_KEY n'est pas configurée, on
//  renvoie { error:'clé ABUSEIPDB requise' } en 200 SANS AUCUN appel réseau.
//
//  CONTRAT (client) :
//    GET /osint/threats?q=<ip>
//    → 200 { ip, abuseScore?, totalReports?, lastReported?, country? }
//    → 200 { error: '<message>' }                          (clé absente / amont KO)
//    Jamais de 500.
//
//  CADRE ARPD : réputation d'IP issue de signalements COMMUNAUTAIRES PUBLICS,
//  usage défensif (tri de menaces, blocage). Aucune donnée personnelle.
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : ABUSEIPDB_KEY (REQUISE).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_Q_LEN = 64;
/** Fenêtre de signalements considérée (jours). */
const MAX_AGE_DAYS = 90;
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

function softError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

interface RawCheck {
  data?: {
    ipAddress?: string;
    abuseConfidenceScore?: number;
    totalReports?: number;
    lastReportedAt?: string | null;
    countryCode?: string | null;
  };
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return softError('paramètre q requis (IP)');
  if (q.length > MAX_Q_LEN) return softError('paramètre q trop long');

  // Règle d'or : sans clé, AUCUN appel réseau.
  const key = process.env.ABUSEIPDB_KEY;
  if (!key) return softError('clé ABUSEIPDB requise');

  const url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(q)}&maxAgeInDays=${MAX_AGE_DAYS}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Key: key,
        'User-Agent': USER_AGENT,
      },
      maxRedirects: 2,
    });
    if (res.status === 401) return softError('clé ABUSEIPDB invalide');
    if (res.status === 422) return softError('IP invalide pour AbuseIPDB');
    if (res.status === 429) return softError('quota ABUSEIPDB atteint (rate-limit)');
    if (!res.ok) return softError(`amont AbuseIPDB ${res.status}`);

    const payload = (await res.json()) as RawCheck;
    const d = payload?.data;
    if (!d) return softError('réponse AbuseIPDB invalide');

    return NextResponse.json(
      {
        ip: d.ipAddress || q,
        abuseScore: typeof d.abuseConfidenceScore === 'number' ? d.abuseConfidenceScore : undefined,
        totalReports: typeof d.totalReports === 'number' ? d.totalReports : undefined,
        lastReported: d.lastReportedAt || undefined,
        country: d.countryCode || undefined,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout AbuseIPDB' : 'échec réseau AbuseIPDB');
  } finally {
    clearTimeout(timeout);
  }
}
