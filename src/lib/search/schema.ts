// ─────────────────────────────────────────────────────────────────────────
//  Mise en forme de la réponse — PORTAGE de open_radar/schema.py.
//  Le SHAPE de sortie est verrouillé par les types TS de src/lib/api.ts (LA LOI,
//  arbitrage 4 du plan) : on renvoie EXACTEMENT `SearchResponse`.
// ─────────────────────────────────────────────────────────────────────────

import type { RadarCard, SearchResponse, SearchResultsGroup, SourceConsulted } from '@/lib/api';
import { inferQueryType } from './classify';

export { inferQueryType };

/** Carte de travail = RadarCard (miroir de RadarResult.to_dict côté Python). */
export type Card = RadarCard;

export const DEFAULT_CANNOT_CONCLUDE = [
  "Ces données ne permettent pas de conclure à la solvabilité ou à la fiabilité commerciale d'une entité.",
  "L'absence de résultat dans une source ne prouve pas l'absence d'information ailleurs.",
  "Ce rapport ne remplace pas une consultation officielle du RCS, du BODACC ou d'un professionnel qualifié.",
];

export const SOURCE_LABELS: Record<string, string> = {
  recherche_entreprises: 'API Recherche Entreprises - api.gouv.fr',
  adresse: 'BAN - Base Adresse Nationale',
  geo_communes: 'API Geo - geo.api.gouv.fr',
  bodacc: 'BODACC - Bulletin Officiel des Annonces Civiles et Commerciales',
  data_gouv: 'data.gouv.fr - catalogue datasets',
};

const utcNow = () => new Date().toISOString();

/** Fabrique une RadarCard avec les mêmes défauts que la dataclass Python. */
export function card(partial: Partial<Card> & Pick<Card, 'source_id' | 'source_label' | 'access_level' | 'confidence' | 'status' | 'title'>): Card {
  return {
    subtitle: '', summary: '', entities: [], raw_ref: {}, limits: [], actions: [],
    raw_preview: {}, provenance: '', ...partial,
  };
}

/** Miroir de schema.py::build_sources_consulted. */
export function buildSourcesConsulted(results: Card[]): SourceConsulted[] {
  const bySource = new Map<string, Card[]>();
  for (const r of results) {
    const arr = bySource.get(r.source_id) ?? [];
    arr.push(r);
    bySource.set(r.source_id, arr);
  }
  const out: SourceConsulted[] = [];
  for (const sourceId of [...bySource.keys()].sort()) {
    const items = bySource.get(sourceId)!;
    const statuses = new Set(items.map((i) => i.status));
    let status: string;
    if (statuses.has('error')) status = 'error';
    else if (statuses.has('partial')) status = 'partial';
    else status = 'ok';
    const firstUrl = items.map((i) => i.raw_ref?.url).find((u) => u) ?? '';
    out.push({
      name: SOURCE_LABELS[sourceId] ?? items[0].source_label,
      source_id: sourceId,
      url: firstUrl,
      status,
      response_time_ms: null,
    });
  }
  return out;
}

/** Miroir de schema.py::group_results. */
export function groupResults(results: Card[]): SearchResultsGroup {
  const grouped: SearchResultsGroup = {
    entreprise: [], adresse_geocodee: [], commune: [],
    bodacc: { annonces: [], alerte_procedure_collective: false, source: SOURCE_LABELS.bodacc },
    datasets: [], raw_cards: [],
  };
  for (const r of results) {
    grouped.raw_cards.push(r);
    if (r.status !== 'found') continue;
    if (r.source_id === 'recherche_entreprises') grouped.entreprise.push(r);
    else if (r.source_id === 'adresse') grouped.adresse_geocodee.push(r);
    else if (r.source_id === 'geo_communes') grouped.commune.push(r);
    else if (r.source_id === 'bodacc') {
      grouped.bodacc.annonces.push(r);
      grouped.bodacc.alerte_procedure_collective =
        grouped.bodacc.alerte_procedure_collective || !!r.raw_preview?.alerte_procedure_collective;
    } else if (r.source_id === 'data_gouv') grouped.datasets.push(r);
  }
  // Pagination entreprises : total réel de l'API (évite de faire croire que N = tout).
  for (const data of grouped.entreprise) {
    const rp = (data.raw_preview ?? {}) as Record<string, unknown>;
    if (rp.total_results !== undefined && rp.total_results !== null) {
      grouped.pagination = {
        total_results: Number(rp.total_results),
        page: Number(rp.page) || 1,
        per_page: Number(rp.per_page) || grouped.entreprise.length,
        shown: grouped.entreprise.length,
      };
      break;
    }
  }
  return grouped;
}

/** Miroir de schema.py::build_standard_response. */
export function buildStandardResponse(query: string, queryType: string | null, results: Card[]): Omit<SearchResponse, 'graph' | 'investigation'> {
  return {
    query,
    query_type: queryType || inferQueryType(query),
    timestamp: utcNow(),
    sources_consulted: buildSourcesConsulted(results),
    results: groupResults(results),
    cannot_conclude: [...DEFAULT_CANNOT_CONCLUDE],
  };
}
