// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / SANCTIONS : recherche entités sanctionnées / PPE.
//
//  SOURCE : https://api.opensanctions.org  — API PUBLIQUE (quota gratuit).
//    • https://api.opensanctions.org/search/default?q={q}
//  OpenSanctions agrège des listes de sanctions officielles (OFAC, UE, ONU…),
//  des registres de personnes politiquement exposées (PPE) et de crime. La clé
//  OPENSANCTIONS_KEY est OPTIONNELLE (relève le quota) : envoyée en
//  `Authorization: ApiKey <clé>` si présente, sinon appel anonyme (quota bas).
//
//  CONTRAT (client) :
//    GET /osint/sanctions?q=<nom|entité>
//    → 200 { hits: { name, schema, datasets?, countries? }[] }
//    → 200 { error: '<message>' }                          (dégradation douce)
//    Jamais de 500.
//
//  CADRE ARPD : consultation de listes de SANCTIONS PUBLIQUES et officielles,
//  usage de conformité / veille défensive. Aucune donnée privée, aucun ciblage.
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : OPENSANCTIONS_KEY (OPTIONNELLE — augmente le quota).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_Q_LEN = 200;
/** Plafond de résultats renvoyés au client. */
const MAX_HITS = 25;
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

interface RawResult {
  caption?: string;
  schema?: string;
  datasets?: string[];
  topics?: string[]; // POURQUOI le hit ressort : sanction, role.pep, crime…
  properties?: { country?: string[]; countries?: string[]; nationality?: string[] };
}

/** Traduit un topic OpenSanctions technique en libellé FR court. */
function topicLabel(t: string): string {
  const map: Record<string, string> = {
    sanction: 'sanction', 'role.pep': 'PPE (politiquement exposé)', 'role.rca': 'proche PPE',
    crime: 'criminalité', 'crime.fin': 'crime financier', 'crime.terror': 'terrorisme',
    'crime.war': 'crime de guerre', 'crime.traffick': 'trafic', debarment: 'exclusion marchés',
    'gov.soe': 'entreprise d’État', wanted: 'recherché',
  };
  return map[t] || t;
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return softError('paramètre q requis (nom ou entité)');
  if (q.length > MAX_Q_LEN) return softError('paramètre q trop long');

  const url = `https://api.opensanctions.org/search/default?q=${encodeURIComponent(q)}&limit=${MAX_HITS}`;

  const baseHeaders: Record<string, string> = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  // Clé effective (OPTIONNELLE) : en-tête user `x-osiris-key-opensanctions` OU
  // env OPENSANCTIONS_KEY (voir keyOf). Absente → appel anonyme (quota bas).
  const key = keyOf(request, 'opensanctions', 'OPENSANCTIONS_KEY');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const call = (useKey: boolean) => {
      const headers = { ...baseHeaders };
      if (useKey && key) headers.Authorization = `ApiKey ${key}`;
      return safeFetch(url, { method: 'GET', signal: controller.signal, headers, maxRedirects: 2 });
    };
    let res = await call(true);
    // Clé REJETÉE (401/403) → repli en ANONYME plutôt qu'un échec dur : la requête
    // a atteint OpenSanctions (donc pas de blocage réseau), l'anonyme marche (quota
    // bas). La clé de Cissou est probablement invalide/expirée → à régénérer.
    if ((res.status === 401 || res.status === 403) && key) res = await call(false);
    if (res.status === 429) return softError('quota OpenSanctions atteint (clé rejetée ou quota anonyme épuisé — vérifier OPENSANCTIONS_KEY)');
    if (!res.ok) return softError(`amont OpenSanctions ${res.status}`);

    const payload = (await res.json()) as { results?: RawResult[] };
    const results = Array.isArray(payload?.results) ? payload.results : [];

    const hits = results.slice(0, MAX_HITS).map((r) => {
      // Les pays peuvent arriver sous plusieurs clés selon le schéma d'entité.
      const p = r.properties ?? {};
      const countries = [
        ...(Array.isArray(p.country) ? p.country : []),
        ...(Array.isArray(p.countries) ? p.countries : []),
        ...(Array.isArray(p.nationality) ? p.nationality : []),
      ];
      const uniqCountries = Array.from(new Set(countries.filter((c) => typeof c === 'string' && c)));
      return {
        name: r.caption || '(sans libellé)',
        schema: r.schema || 'Unknown',
        datasets: Array.isArray(r.datasets) && r.datasets.length ? r.datasets : undefined,
        countries: uniqCountries.length ? uniqCountries : undefined,
        topics: Array.isArray(r.topics) && r.topics.length ? r.topics.map(topicLabel) : undefined,
      };
    });

    // Motifs agrégés (POURQUOI ça ressort) — sinon un hit est aveugle.
    const topics = Array.from(
      new Set(results.flatMap((r) => (Array.isArray(r.topics) ? r.topics : [])).map(topicLabel)),
    );

    return NextResponse.json(
      { hits, ...(topics.length ? { topics } : {}) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout OpenSanctions' : 'échec réseau OpenSanctions');
  } finally {
    clearTimeout(timeout);
  }
}
