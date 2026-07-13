// ─────────────────────────────────────────────────────────────────────────
//  Graphe d'investigation pour une recherche simple — PORTAGE de
//  open_radar/investigation.py::build_graph (+ helpers) SANS la cascade (celle-ci
//  = Phase 3). Nœud central « Recherche » relié à chaque résultat + pivots
//  dirigeants/adresse depuis les cartes entreprise. Alimente la vue « Graphe ».
// ─────────────────────────────────────────────────────────────────────────

import type { Graph, GraphNode, GraphEdge } from '@/lib/api';
import type { Card } from './schema';

export type NodeMap = Map<string, GraphNode>;
export type EdgeMap = Map<string, GraphEdge>;

export const norm = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function personLabel(nom: unknown, prenoms: unknown): string {
  const p = String(prenoms ?? '').split(' ')[0];
  return `${titleCase(p)} ${titleCase(String(nom ?? ''))}`.trim();
}

function entityOf(card: Card, type: string): string {
  const e = (card.entities || []).find((x) => x.type === type && x.value);
  return e?.value ?? '';
}
export const sirenOf = (c: Card) => entityOf(c, 'siren');
const inseeOf = (c: Card) => entityOf(c, 'code_insee');

export function addNode(nodes: NodeMap, id: string, label: string, type: string, extra?: Record<string, unknown>): string {
  if (!nodes.has(id)) nodes.set(id, { id, label, type, ...(extra ?? {}) });
  return id;
}

export function addEdge(edges: EdgeMap, src: string, dst: string, rel: string): void {
  if (src && dst && src !== dst) {
    const k = `${src}|${dst}|${rel}`;
    if (!edges.has(k)) edges.set(k, { from: src, to: dst, relation: rel });
  }
}

export function cardNode(nodes: NodeMap, card: Card): string | null {
  const sid = card.source_id;
  if (sid === 'recherche_entreprises') {
    const siren = sirenOf(card);
    return addNode(nodes, `C:${siren || card.title}`, card.title, 'company', { siren });
  }
  if (sid === 'bodacc') {
    const siren = sirenOf(card);
    return addNode(nodes, `B:${siren || card.title}`, card.title, 'bodacc', { siren });
  }
  if (sid === 'geo_communes') {
    const insee = inseeOf(card);
    return addNode(nodes, `M:${insee || card.title}`, card.title, 'commune');
  }
  if (sid === 'adresse') return addNode(nodes, `A:${norm(card.title)}`, card.title, 'address');
  if (sid === 'rna') {
    const siren = sirenOf(card);
    const rna = entityOf(card, 'rna');
    return addNode(nodes, `R:${rna || siren || card.title}`, card.title, 'association', { siren });
  }
  return null; // datasets, DVF territoire, etc. → hors graphe (réduction du bruit)
}

export function stats(nodes: NodeMap): Record<string, number> {
  const vals = [...nodes.values()];
  return {
    companies: vals.filter((n) => n.type === 'company').length,
    persons: vals.filter((n) => n.type === 'person').length,
    addresses: vals.filter((n) => n.type === 'address').length,
  };
}

/** Miroir de investigation.py::build_graph (recherche simple). */
export function buildGraph(cards: Card[], query = ''): Graph {
  const nodes: NodeMap = new Map();
  const edges: EdgeMap = new Map();
  const root = addNode(nodes, 'ROOT', query || 'Recherche', 'origin');

  // 1) nœuds entreprise d'abord (pour que BODACC puisse s'y rattacher).
  for (const c of cards) if (c.status === 'found' && c.source_id === 'recherche_entreprises') cardNode(nodes, c);

  for (const c of cards) {
    if (c.status !== 'found') continue;
    const nid = cardNode(nodes, c);
    if (!nid) continue;
    if (c.source_id === 'bodacc') {
      const siren = sirenOf(c);
      const company = siren && nodes.has(`C:${siren}`) ? `C:${siren}` : null;
      addEdge(edges, company || root, nid, company ? 'BODACC' : 'résultat');
    } else {
      addEdge(edges, root, nid, 'résultat');
    }

    if (c.source_id === 'recherche_entreprises') {
      const rp = (c.raw_preview ?? {}) as Record<string, unknown>;
      const pivots = (rp.dirigeants_pivot as Array<Record<string, unknown>>) || [];
      for (const d of pivots) {
        const nom = d.nom;
        const prenoms = d.prenoms ?? '';
        if (!nom) continue;
        const pid = addNode(nodes, `P:${norm(nom)}|${norm(prenoms)}`, personLabel(nom, prenoms), 'person', {
          nom: String(nom), prenoms: String(prenoms),
        });
        addEdge(edges, pid, nid, 'dirige');
      }
      if (rp.adresse_pivot) {
        const aid = addNode(nodes, `A:${norm(rp.adresse_pivot)}`, String(rp.adresse_pivot), 'address');
        addEdge(edges, nid, aid, 'siège');
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], stats: stats(nodes) };
}
