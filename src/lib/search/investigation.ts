// ─────────────────────────────────────────────────────────────────────────
//  Investigation auto (pivot OSINT) — PORTAGE de open_radar/investigation.py.
//  Cascade BFS BORNÉE À L'IDENTIQUE : mêmes budgets profondeur/appels/temps que
//  le Python (OSINT sur des personnes → les bornes sont une règle, pas une option).
//  Provenance affichée par nœud, dédup pivots + cartes, données publiques only.
// ─────────────────────────────────────────────────────────────────────────

import type { Graph } from '@/lib/api';
import type { Card } from './schema';
import { norm, personLabel, sirenOf, addNode, addEdge, cardNode, stats, type NodeMap, type EdgeMap } from './graph';
import { searchEntreprises, searchPersonne, searchCommunes } from './connectors';
import { searchBodacc } from './connectors2';

const personKey = (nom: string, prenoms: string) => `person:${norm(nom)}|${norm(prenoms)}`;

interface Pivot {
  kind: 'bodacc' | 'person' | 'address' | 'commune';
  key: string;
  label: string;
  siren?: string;
  nom?: string;
  prenoms?: string;
  adresse?: string;
  postcode?: string;
}

/** Miroir de investigation.py::extract_pivots. */
function extractPivots(card: Card): Pivot[] {
  const pivots: Pivot[] = [];
  const rp = (card.raw_preview ?? {}) as Record<string, unknown>;
  const siren = sirenOf(card);

  if (siren && card.source_id === 'recherche_entreprises') {
    pivots.push({ kind: 'bodacc', key: `bodacc:${siren}`, siren, label: `SIREN ${siren} (${card.title})` });
  }
  for (const d of (rp.dirigeants_pivot as Array<Record<string, unknown>>) || []) {
    const nom = d.nom as string | undefined;
    const prenoms = (d.prenoms as string) || '';
    if (!nom) continue;
    pivots.push({ kind: 'person', key: personKey(nom, prenoms), nom, prenoms, label: `${personLabel(nom, prenoms)}, dirigeant de ${card.title}` });
  }
  const adresse = rp.adresse_pivot as string | undefined;
  if (adresse) pivots.push({ kind: 'address', key: `address:${norm(adresse)}`, adresse, label: `adresse « ${adresse} » (${card.title})` });
  const postcode = rp.postcode_pivot as string | undefined;
  if (postcode) pivots.push({ kind: 'commune', key: `commune:${postcode}`, postcode, label: `code postal ${postcode}` });
  return pivots;
}

/** Miroir de investigation.py::run_pivot. */
async function runPivot(pivot: Pivot): Promise<Card[]> {
  if (pivot.kind === 'bodacc') return searchBodacc(pivot.siren!);
  if (pivot.kind === 'person') return searchPersonne(pivot.nom!, pivot.prenoms || '');
  if (pivot.kind === 'address') return searchEntreprises(pivot.adresse!, { perPage: 5 });
  if (pivot.kind === 'commune') return searchCommunes(pivot.postcode!);
  return [];
}

export interface InvestigateMeta {
  depth: number;
  entities: number;
  pivots_explored: number;
  api_calls: number;
  budget_reached: boolean;
  time_budget_reached: boolean;
  elapsed_s: number;
}

/** Miroir de investigation.py::investigate (BFS bornée). */
export async function investigate(
  seeds: Card[],
  { query = '', maxDepth = 2, callBudget = 40, pivotPersons = true, timeBudgetS = 25.0 }:
    { query?: string; maxDepth?: number; callBudget?: number; pivotPersons?: boolean; timeBudgetS?: number } = {},
): Promise<{ results: Card[]; meta: InvestigateMeta; graph: Graph }> {
  const started = Date.now();
  const visitedPivots = new Set<string>();
  const seenCards = new Set<string>();
  const out: Card[] = [];
  let calls = 0;
  let timeExhausted = false;

  const nodes: NodeMap = new Map();
  const edges: EdgeMap = new Map();
  const root = addNode(nodes, 'ROOT', query || 'Recherche', 'origin');

  // file : (carte, profondeur, nœud parent, relation, provenance)
  type QItem = { card: Card; depth: number; parent: string; rel: string; prov: string };
  const queue: QItem[] = seeds.map((c) => ({ card: c, depth: 0, parent: root, rel: 'résultat', prov: '' }));

  while (queue.length) {
    const { card, depth, parent, rel, prov } = queue.shift()!;
    const nid = card.status === 'found' ? cardNode(nodes, card) : null;
    if (nid && parent) addEdge(edges, parent, nid, rel);

    const cardKey = `${card.source_id}|${card.subtitle || card.title}`;
    if (seenCards.has(cardKey)) continue; // l'arête est déjà tracée → connecte les clusters
    seenCards.add(cardKey);
    if (prov) card.provenance = prov;
    out.push(card);

    if (depth >= maxDepth || card.status !== 'found' || card.source_id !== 'recherche_entreprises') continue;

    const cid = nid!;
    for (const pivot of extractPivots(card)) {
      if (!pivotPersons && pivot.kind === 'person') continue;

      let connector: string | null = null;
      let childRel = 'lié';
      if (pivot.kind === 'person') {
        const pid = addNode(nodes, `P:${norm(pivot.nom)}|${norm(pivot.prenoms ?? '')}`, personLabel(pivot.nom, pivot.prenoms ?? ''), 'person', { nom: String(pivot.nom), prenoms: String(pivot.prenoms ?? '') });
        addEdge(edges, pid, cid, 'dirige');
        connector = pid; childRel = 'dirige';
      } else if (pivot.kind === 'address') {
        const aid = addNode(nodes, `A:${norm(pivot.adresse)}`, String(pivot.adresse), 'address');
        addEdge(edges, cid, aid, 'siège');
        connector = aid; childRel = 'même adresse';
      } else if (pivot.kind === 'bodacc') {
        childRel = 'BODACC';
      } else if (pivot.kind === 'commune') {
        childRel = 'commune';
      }

      if (visitedPivots.has(pivot.key)) continue;
      visitedPivots.add(pivot.key);
      if ((Date.now() - started) / 1000 > timeBudgetS) { timeExhausted = true; continue; }
      if (calls >= callBudget) continue;
      calls += 1;
      const childParent = connector ?? cid;
      for (const newCard of await runPivot(pivot)) {
        queue.push({ card: newCard, depth: depth + 1, parent: childParent, rel: childRel, prov: pivot.label });
      }
    }
  }

  const meta: InvestigateMeta = {
    depth: maxDepth,
    entities: out.length,
    pivots_explored: visitedPivots.size,
    api_calls: calls,
    budget_reached: calls >= callBudget || timeExhausted,
    time_budget_reached: timeExhausted,
    elapsed_s: Math.round((Date.now() - started) / 100) / 10,
  };
  const graph: Graph = { nodes: [...nodes.values()], edges: [...edges.values()], stats: stats(nodes) };
  return { results: out, meta, graph };
}
