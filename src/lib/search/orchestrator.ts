// ─────────────────────────────────────────────────────────────────────────
//  Orchestrateur — PORTAGE de open_radar/orchestrator.py::search / search_standard.
//  Fan-out PARALLÈLE des connecteurs de la requête (un échec ne fait pas tomber
//  les autres). ⚠️ Phase 1 : seuls entreprises/adresse/geo/datagouv sont câblés ;
//  les routes rna/bodacc/foncier existent (classifyQuery) mais leurs connecteurs
//  arrivent en Phase 2 → ignorées pour l'instant (parité progressive, documentée).
// ─────────────────────────────────────────────────────────────────────────

import type { SearchResponse } from '@/lib/api';
import { classifyQuery, POSTCODE_RE } from './classify';
import { buildStandardResponse, type Card } from './schema';
import { buildGraph } from './graph';
import { searchEntreprises, searchAdresse, searchCommunes, searchDatagouv } from './connectors';

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
  if (routes.includes('adresse')) tasks.push(searchAdresse(query));
  if (routes.includes('geo')) tasks.push(searchCommunes(geoQuery));
  if (routes.includes('datagouv')) tasks.push(searchDatagouv(query));
  // Phase 2 (à câbler) : 'rna' → searchAssociations · 'bodacc' → searchBodacc · 'foncier' → searchFoncier.

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
