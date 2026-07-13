// ─────────────────────────────────────────────────────────────────────────
//  Orchestrateur — PORTAGE de open_radar/orchestrator.py::search / search_standard.
//  Fan-out PARALLÈLE des connecteurs de la requête (un échec ne fait pas tomber
//  les autres). Phase 1 : entreprises/adresse/geo/datagouv. Phase 2 (V4.091) :
//  rna/bodacc/foncier câblés → toutes les routes de classifyQuery sont couvertes.
// ─────────────────────────────────────────────────────────────────────────

import type { SearchResponse } from '@/lib/api';
import { classifyQuery, POSTCODE_RE, inferQueryType } from './classify';
import { buildStandardResponse, type Card } from './schema';
import { buildGraph } from './graph';
import { searchEntreprises, searchAdresse, searchCommunes, searchDatagouv, searchPersonne } from './connectors';
import { searchBodacc, searchFoncier, searchAssociations } from './connectors2';
import { investigate } from './investigation';

export interface SearchArgs {
  filters?: Record<string, unknown> | null;
  page?: number;
}

/** Miroir de orchestrator.py::search (fan-out parallèle). Phase 1 = 4 connecteurs. */
export async function search(query: string, { filters, page = 1 }: SearchArgs = {}): Promise<Card[]> {
  const routes = classifyQuery(query);
  const postcode = query.match(POSTCODE_RE)?.[0];
  // Code postal présent → on interroge la commune PAR ce code (fiable) plutôt que le texte entier.
  const geoQuery = postcode ?? query;

  const tasks: Array<Promise<Card[]>> = [];
  if (routes.includes('entreprises')) tasks.push(searchEntreprises(query, { filters, page }));
  if (routes.includes('rna')) tasks.push(searchAssociations(query));
  if (routes.includes('bodacc')) tasks.push(searchBodacc(query));
  if (routes.includes('adresse')) tasks.push(searchAdresse(query));
  if (routes.includes('geo')) tasks.push(searchCommunes(geoQuery));
  // 'foncier' n'est routé QUE si un code postal est présent (cf. classifyQuery) → on le passe à DVF.
  if (routes.includes('foncier') && postcode) tasks.push(searchFoncier({ codePostal: postcode }));
  if (routes.includes('datagouv')) tasks.push(searchDatagouv(query));

  if (tasks.length === 0) return [];
  const batches = await Promise.all(tasks);
  return batches.flat();
}

/** Miroir de orchestrator.py::search_standard (réponse + graphe). */
export async function searchStandard(query: string, args: SearchArgs = {}): Promise<SearchResponse> {
  const results = await search(query, args);
  const base = buildStandardResponse(query, null, results);
  return { ...base, graph: buildGraph(results, query) };
}

/** Miroir de orchestrator.py::search_person_standard. */
export async function searchPersonStandard(nom: string, prenoms = ''): Promise<SearchResponse> {
  const results = await searchPersonne(nom, prenoms);
  const label = `${prenoms} ${nom}`.trim();
  const base = buildStandardResponse(label, 'personne', results);
  return { ...base, graph: buildGraph(results, label) };
}

/** Miroir de orchestrator.py::investigate_standard (cascade bornée). */
export async function investigateStandard(args: { q?: string; nom?: string; prenoms?: string }): Promise<SearchResponse> {
  let seeds: Card[];
  let label: string;
  let queryType: string;
  if (args.nom) {
    seeds = await searchPersonne(args.nom, args.prenoms || '');
    label = `${args.prenoms || ''} ${args.nom}`.trim();
    queryType = 'personne';
  } else {
    const q = args.q || '';
    seeds = await search(q);
    label = q;
    queryType = inferQueryType(q);
  }
  const { results, meta, graph } = await investigate(seeds, { query: label, maxDepth: 2, pivotPersons: true });
  const base = buildStandardResponse(label, queryType, results);
  return { ...base, investigation: meta as unknown as Record<string, unknown>, graph };
}
