'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  EntityGraphPanel.tsx — Panneau « Graphe d'entités » (OSIRIS V4 · cockpit)
//  Agent GRAPHE D'ENTITÉS
//
//  RÔLE
//  ────
//  À partir d'une cible d'enquête (domaine, IP, ASN, email, pseudo GitHub),
//  affiche un GRAPHE NŒUDS/LIENS des entités liées, servi par la route
//  serveur `/entity/expand`. Chaque nœud est CLIQUABLE pour l'étendre : on
//  rappelle la route et on fusionne les nouveaux nœuds/liens dans le graphe.
//  Données strictement PUBLIQUES (usage défensif / ARPD).
//
//  RENDU FORCE-DIRECTED FAIT MAISON
//  ────────────────────────────────
//  Aucune dépendance lourde (pas de d3 / react-force-graph). Une petite
//  simulation de forces (répulsion coulombienne entre nœuds + ressorts sur les
//  liens + gravité de centrage) est intégrée par `requestAnimationFrame` et
//  refroidit progressivement (alpha). Le SVG est rendu à chaque frame ; on
//  peut glisser un nœud à la souris, zoomer à la molette et déplacer le fond.
//
//  CHARTE V3 (cohérence graphique) : panneau glassmorphism `glass-panel`,
//  libellés mono (IBM Plex Mono / --font-hud), accent --accent (#54bdde),
//  apparition douce (framer-motion), scrollbar `styled-scrollbar`. Couleurs des
//  nœuds par nature (domaine=accent, ip=accent-bright, asn=violet, cert=vert,
//  person=ambre, org=ambre, registrar=gris, email=accent-deep).
//
//  INTÉGRATION (dans src/app/page.tsx) :
//    import EntityGraphPanel from '@/components/EntityGraphPanel';
//    const [graphOpen, setGraphOpen] = useState(false);
//    // ... un bouton « Graphe » de la barre d'outils :
//    <button onClick={() => setGraphOpen(true)}>Graphe</button>
//    // ... dans le JSX (à côté des autres panneaux) :
//    <AnimatePresence>
//      {graphOpen && (
//        <EntityGraphPanel
//          seed="exemple.com"                 // optionnel : cible initiale
//          onClose={() => setGraphOpen(false)}
//        />
//      )}
//    </AnimatePresence>
//  Sans `seed`, le panneau s'ouvre sur un champ vide (l'utilisateur saisit la
//  cible puis clique « Explorer »). Avec `seed`, l'exploration démarre au montage.
// ─────────────────────────────────────────────────────────────────────────────

import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Search, Loader2, Crosshair, RotateCcw } from 'lucide-react';
import { BASE_PATH } from '@/lib/api';

// ── Types (miroir du contrat de /entity/expand) ──────────────────────────────
type NodeKind = 'domaine' | 'ip' | 'asn' | 'cert' | 'person' | 'org' | 'registrar' | 'email';

/** Nœud tel que renvoyé par la route. */
interface ApiNode {
  id: string;
  label: string;
  kind: NodeKind;
  meta?: Record<string, string>;
}
/** Lien tel que renvoyé par la route. */
interface ApiEdge {
  source: string;
  target: string;
  label?: string;
}
/** Réponse complète de la route. */
interface ApiGraph {
  seed: { id: string; kind: NodeKind };
  nodes: ApiNode[];
  edges: ApiEdge[];
}

/** Nœud enrichi des champs de simulation (position/vitesse). */
interface SimNode extends ApiNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean; // vrai pendant un drag → les forces ne le bougent pas
}

interface EntityGraphPanelProps {
  /** Cible initiale (optionnelle) : lance l'exploration au montage si fournie. */
  seed?: string;
  /** Ferme le panneau. */
  onClose: () => void;
  isMobile?: boolean;
}

// ── Palette des nœuds par nature (charte V3) ─────────────────────────────────
const KIND_COLOR: Record<NodeKind, string> = {
  domaine: '#54bdde', // accent
  ip: '#9bdcf0', // accent-bright
  asn: '#9a8cef', // violet
  cert: '#6bd6a1', // vert
  person: '#d6a445', // ambre
  org: '#e0a35f', // ambre chaud
  registrar: '#7f8da1', // gris (muted)
  email: '#2f8fb3', // accent-deep
};
/** Libellés FR des natures (légende). */
const KIND_LABEL: Record<NodeKind, string> = {
  domaine: 'Domaine',
  ip: 'IP',
  asn: 'ASN',
  cert: 'Sous-domaine',
  person: 'Personne',
  org: 'Organisation',
  registrar: 'Registrar',
  email: 'Email',
};

// ── Paramètres de la simulation de forces ────────────────────────────────────
const REPULSION = 5400; // intensité de la répulsion nœud↔nœud
const SPRING_LEN = 96; // longueur de repos d'un lien
const SPRING_K = 0.024; // raideur des ressorts (liens)
const GRAVITY = 0.016; // rappel vers le centre
const DAMPING = 0.85; // amortissement des vitesses
const MAX_V = 20; // vitesse max (stabilité numérique)
const ALPHA_MIN = 0.04; // plancher de « chaleur » (jitter résiduel quasi nul)
const ALPHA_DECAY = 0.985; // refroidissement par frame

// ── Helpers ──────────────────────────────────────────────────────────────────
/** Rayon d'un nœud (racine plus grosse). */
function nodeRadius(id: string, rootId: string): number {
  return id === rootId ? 22 : 14;
}
/** Tronque un libellé trop long pour l'affichage sous un nœud. */
function truncate(s: string, n = 22): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function EntityGraphPanel({ seed, onClose, isMobile }: EntityGraphPanelProps) {
  // ── État réactif « léger » (déclenche le re-rendu) ──────────────────────────
  const [query, setQuery] = useState(seed ?? '');
  const [loading, setLoading] = useState(false); // exploration initiale (champ)
  const [expandingId, setExpandingId] = useState<string | null>(null); // nœud en cours d'extension
  const [error, setError] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 }); // pan/zoom

  // ── État « lourd » en refs (muté à 60 fps, rendu via tick) ───────────────────
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<ApiEdge[]>([]);
  const rootIdRef = useRef<string>('');
  const alphaRef = useRef(0);
  const sizeRef = useRef({ w: 900, h: 600 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Interaction souris (refs → pas de closures périmées).
  const dragRef = useRef<{ id: string; ox: number; oy: number; moved: boolean } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; x0: number; y0: number; moved: boolean } | null>(null);

  // Forçage de re-rendu à chaque frame (positions vivent dans nodesRef).
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // ── Mesure du conteneur (centre de la simulation) ────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) sizeRef.current = { w: r.width, h: r.height };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Réchauffe la simulation (après ajout de nœuds ou interaction) ────────────
  const reheat = useCallback(() => {
    alphaRef.current = 1;
  }, []);

  // ── Fusion d'un graphe API dans l'état de simulation ─────────────────────────
  const mergeGraph = useCallback(
    (graph: ApiGraph, aroundId?: string) => {
      const nodes = nodesRef.current;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const { w, h } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;

      // Point d'ancrage des nouveaux nœuds : autour du nœud étendu, sinon centre.
      const anchor = aroundId ? byId.get(aroundId) : undefined;
      const ax = anchor?.x ?? cx;
      const ay = anchor?.y ?? cy;

      for (const n of graph.nodes) {
        const existing = byId.get(n.id);
        if (existing) {
          // Enrichit sans écraser la position ni la nature déjà connue.
          if (n.meta) existing.meta = { ...existing.meta, ...n.meta };
          continue;
        }
        // Placement initial : petit cercle aléatoire autour de l'ancre.
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 70;
        const sim: SimNode = {
          ...n,
          x: ax + Math.cos(angle) * dist,
          y: ay + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          fixed: false,
        };
        nodes.push(sim);
        byId.set(n.id, sim);
      }

      // Fusion des liens (dédup par source|target|label).
      const edges = edgesRef.current;
      const seen = new Set(edges.map((e) => `${e.source}|${e.target}|${e.label ?? ''}`));
      for (const e of graph.edges) {
        const key = `${e.source}|${e.target}|${e.label ?? ''}`;
        if (seen.has(key)) continue;
        // Ne garde un lien que si ses deux extrémités existent réellement.
        if (byId.has(e.source) && byId.has(e.target)) {
          seen.add(key);
          edges.push(e);
        }
      }

      reheat();
      forceRender();
    },
    [reheat],
  );

  // ── Appel réseau vers /entity/expand ─────────────────────────────────────────
  const fetchGraph = useCallback(async (q: string, type?: NodeKind): Promise<ApiGraph | null> => {
    const params = new URLSearchParams({ q });
    if (type) params.set('type', type);
    try {
      // ⚠️ BASE_PATH obligatoire : sans le préfixe `/cockpit`, la requête sort de
      //  l'app Next et tombe sur le backend V3 (racine) → 401 (bug repéré 12/07).
      const res = await fetch(`${BASE_PATH}/entity/expand?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) return null;
      return (await res.json()) as ApiGraph;
    } catch {
      return null;
    }
  }, []);

  // ── Exploration depuis le champ (repart d'un graphe vierge) ──────────────────
  const explore = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q || loading) return;
      setLoading(true);
      setError(null);
      const graph = await fetchGraph(q);
      setLoading(false);
      if (!graph || !graph.seed.id || graph.nodes.length === 0) {
        setError('Aucune entité trouvée pour cette cible.');
        return;
      }
      // Réinitialise le graphe autour de la nouvelle racine, centrée.
      const { w, h } = sizeRef.current;
      nodesRef.current = [];
      edgesRef.current = [];
      rootIdRef.current = graph.seed.id;
      setSelectedId(graph.seed.id);
      setTransform({ x: 0, y: 0, k: 1 });
      // Place la racine au centre AVANT de fusionner (les enfants s'y accrochent).
      nodesRef.current.push({
        ...(graph.nodes.find((n) => n.id === graph.seed.id) ?? {
          id: graph.seed.id,
          label: graph.seed.id,
          kind: graph.seed.kind,
        }),
        x: w / 2,
        y: h / 2,
        vx: 0,
        vy: 0,
        fixed: false,
      });
      mergeGraph(graph, graph.seed.id);
    },
    [fetchGraph, loading, mergeGraph],
  );

  // ── Extension d'un nœud (clic) ───────────────────────────────────────────────
  const expandNode = useCallback(
    async (id: string) => {
      if (expandingId) return; // une extension à la fois
      setSelectedId(id);
      setExpandingId(id);
      setError(null);
      const node = nodesRef.current.find((n) => n.id === id);
      const graph = await fetchGraph(id, node?.kind);
      setExpandingId(null);
      if (!graph || graph.nodes.length === 0) return; // rien de neuf → silencieux
      mergeGraph(graph, id);
    },
    [expandingId, fetchGraph, mergeGraph],
  );

  // ── Exploration initiale si `seed` fourni ────────────────────────────────────
  useEffect(() => {
    if (seed && seed.trim()) void explore(seed);
    // Volontairement au montage uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Boucle de simulation (requestAnimationFrame) ─────────────────────────────
  useEffect(() => {
    const step = () => {
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const n = nodes.length;
      if (n > 0) {
        const alpha = alphaRef.current;
        const { w, h } = sizeRef.current;
        const cx = w / 2;
        const cy = h / 2;

        // Accumulateurs de force par nœud.
        const fx = new Float64Array(n);
        const fy = new Float64Array(n);
        const idx = new Map<string, number>();
        for (let i = 0; i < n; i++) idx.set(nodes[i].id, i);

        // Répulsion coulombienne (toutes paires — O(n²), trivial pour ≤40).
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            let dx = nodes[i].x - nodes[j].x;
            let dy = nodes[i].y - nodes[j].y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
              // Superposition exacte → petite perturbation déterministe.
              dx = (i - j) * 0.5 + 0.1;
              dy = (j - i) * 0.5 + 0.1;
              d2 = dx * dx + dy * dy;
            }
            const d = Math.sqrt(d2);
            const f = (REPULSION * alpha) / d2;
            const ux = dx / d;
            const uy = dy / d;
            fx[i] += ux * f;
            fy[i] += uy * f;
            fx[j] -= ux * f;
            fy[j] -= uy * f;
          }
        }

        // Ressorts sur les liens (attraction vers SPRING_LEN).
        for (const e of edges) {
          const a = idx.get(e.source);
          const b = idx.get(e.target);
          if (a === undefined || b === undefined) continue;
          let dx = nodes[b].x - nodes[a].x;
          let dy = nodes[b].y - nodes[a].y;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d < 0.01) d = 0.01;
          const force = (d - SPRING_LEN) * SPRING_K * alpha;
          const ux = dx / d;
          const uy = dy / d;
          fx[a] += ux * force;
          fy[a] += uy * force;
          fx[b] -= ux * force;
          fy[b] -= uy * force;
        }

        // Gravité de centrage + intégration.
        for (let i = 0; i < n; i++) {
          const node = nodes[i];
          if (node.fixed) {
            node.vx = 0;
            node.vy = 0;
            continue;
          }
          fx[i] += (cx - node.x) * GRAVITY * alpha;
          fy[i] += (cy - node.y) * GRAVITY * alpha;
          node.vx = (node.vx + fx[i]) * DAMPING;
          node.vy = (node.vy + fy[i]) * DAMPING;
          // Clamp de vitesse (stabilité).
          if (node.vx > MAX_V) node.vx = MAX_V;
          else if (node.vx < -MAX_V) node.vx = -MAX_V;
          if (node.vy > MAX_V) node.vy = MAX_V;
          else if (node.vy < -MAX_V) node.vy = -MAX_V;
          node.x += node.vx;
          node.y += node.vy;
        }

        // Refroidissement (jusqu'au plancher).
        if (alphaRef.current > ALPHA_MIN) alphaRef.current *= ALPHA_DECAY;
        forceRender();
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Conversion coordonnées écran → coordonnées de simulation ─────────────────
  const toSim = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      const localX = clientX - (rect?.left ?? 0);
      const localY = clientY - (rect?.top ?? 0);
      return {
        x: (localX - transform.x) / transform.k,
        y: (localY - transform.y) / transform.k,
      };
    },
    [transform],
  );

  // ── Souris : début de geste (nœud ou fond) ───────────────────────────────────
  const onNodePointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      const node = nodesRef.current.find((nd) => nd.id === id);
      if (!node) return;
      const p = toSim(e.clientX, e.clientY);
      node.fixed = true;
      dragRef.current = { id, ox: p.x - node.x, oy: p.y - node.y, moved: false };
    },
    [toSim],
  );

  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      panRef.current = { sx: e.clientX, sy: e.clientY, x0: transform.x, y0: transform.y, moved: false };
    },
    [transform],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const p = toSim(e.clientX, e.clientY);
        const node = nodesRef.current.find((nd) => nd.id === drag.id);
        if (node) {
          node.x = p.x - drag.ox;
          node.y = p.y - drag.oy;
          node.vx = 0;
          node.vy = 0;
        }
        if (!drag.moved && Math.hypot(e.movementX, e.movementY) > 0) drag.moved = true;
        reheat();
        forceRender();
        return;
      }
      const pan = panRef.current;
      if (pan) {
        const dx = e.clientX - pan.sx;
        const dy = e.clientY - pan.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        setTransform((t) => ({ ...t, x: pan.x0 + dx, y: pan.y0 + dy }));
      }
    },
    [toSim, reheat],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const node = nodesRef.current.find((nd) => nd.id === drag.id);
        if (node) node.fixed = false;
        // Clic net (pas de déplacement) → on étend le nœud.
        if (!drag.moved) void expandNode(drag.id);
        dragRef.current = null;
        reheat();
        return;
      }
      panRef.current = null;
      // (e ignoré au-delà de la libération du pointeur)
      void e;
    },
    [expandNode, reheat],
  );

  // ── Molette : zoom autour du curseur ─────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    setTransform((t) => {
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const k = Math.min(2.5, Math.max(0.35, t.k * factor));
      // Garde le point sous le curseur fixe pendant le zoom.
      const x = px - ((px - t.x) * k) / t.k;
      const y = py - ((py - t.y) * k) / t.k;
      return { x, y, k };
    });
  }, []);

  // ── Recentrer / réinitialiser la vue ─────────────────────────────────────────
  const resetView = useCallback(() => {
    setTransform({ x: 0, y: 0, k: 1 });
    reheat();
  }, [reheat]);

  // ── Rendu ────────────────────────────────────────────────────────────────────
  const nodes = nodesRef.current;
  const edges = edgesRef.current;
  const rootId = rootIdRef.current;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="absolute z-[210] pointer-events-auto glass-panel border border-[var(--border-primary)] flex flex-col overflow-hidden"
      style={{
        top: isMobile ? '64px' : '96px',
        bottom: isMobile ? '76px' : '96px',
        left: isMobile ? '10px' : '80px',
        right: isMobile ? '10px' : '80px',
      }}
    >
      {/* ── En-tête ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)] flex-shrink-0">
        <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
          Graphe d’entités
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={resetView}
            className="text-white/40 hover:text-white transition-colors"
            title="Recentrer la vue"
          >
            <Crosshair className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Barre de recherche ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--faint)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void explore(query);
            }}
            placeholder="domaine, IP, ASxxxx, email ou pseudo…"
            className="w-full bg-black/30 border border-[var(--border-primary)] rounded-md pl-8 pr-3 py-1.5 text-[12px] font-mono text-white/90 placeholder:text-[var(--faint)] focus:outline-none focus:border-[var(--accent-line)]"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
          />
        </div>
        <button
          onClick={() => void explore(query)}
          disabled={loading || !query.trim()}
          className="osiris-btn-primary text-[11px] font-mono px-3 py-1.5 rounded-md disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Explorer
        </button>
      </div>

      {/* ── Zone graphe ── */}
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-hidden">
        {/* Message d'erreur (dégradation douce) */}
        {error && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 text-[11px] font-mono text-[#e0736f] bg-[#e0736f]/10 border border-[#e0736f]/25 rounded px-3 py-1.5 pointer-events-none">
            {error}
          </div>
        )}

        {/* État vide (avant toute exploration) */}
        {nodes.length === 0 && !loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] font-mono text-[var(--muted)] px-6 text-center">
            Saisis une cible puis clique « Explorer » pour construire le graphe.
            <br />
            Clique ensuite un nœud pour l’étendre.
          </div>
        )}

        {/* Chargement initial */}
        {loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] font-mono text-[var(--muted)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
            Construction du graphe…
          </div>
        )}

        {/* SVG force-directed */}
        <svg
          ref={svgRef}
          className="w-full h-full block touch-none select-none"
          style={{ cursor: panRef.current ? 'grabbing' : 'grab' }}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {/* Liens (dessinés d'abord, sous les nœuds) */}
            {edges.map((e, i) => {
              const a = byId.get(e.source);
              const b = byId.get(e.target);
              if (!a || !b) return null;
              const hovered = hoveredEdge === i;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <g key={`e${i}`}>
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={hovered ? 'var(--accent)' : 'rgba(255,255,255,0.16)'}
                    strokeWidth={hovered ? 1.6 : 1}
                    onPointerEnter={() => setHoveredEdge(i)}
                    onPointerLeave={() => setHoveredEdge((h) => (h === i ? null : h))}
                    style={{ cursor: 'default' }}
                  />
                  {hovered && e.label && (
                    <text
                      x={mx}
                      y={my - 4}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize={9}
                      fill="var(--accent-bright)"
                      style={{ pointerEvents: 'none' }}
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nœuds */}
            {nodes.map((nd) => {
              const r = nodeRadius(nd.id, rootId);
              const color = KIND_COLOR[nd.kind] ?? '#7f8da1';
              const isSelected = selectedId === nd.id;
              const isExpanding = expandingId === nd.id;
              return (
                <g
                  key={nd.id}
                  transform={`translate(${nd.x},${nd.y})`}
                  onPointerDown={(ev) => onNodePointerDown(ev, nd.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Halo de sélection */}
                  {isSelected && (
                    <circle r={r + 5} fill="none" stroke={color} strokeWidth={1} opacity={0.5} />
                  )}
                  <circle
                    r={r}
                    fill={`${color}22`}
                    stroke={color}
                    strokeWidth={isSelected ? 2.2 : 1.6}
                  />
                  {/* Anneau de chargement pendant l'extension */}
                  {isExpanding && (
                    <circle
                      r={r + 3}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      strokeDasharray="4 6"
                      opacity={0.9}
                    >
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0"
                        to="360"
                        dur="1s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}
                  {/* Libellé sous le nœud */}
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    className="font-mono"
                    fontSize={10}
                    fill="rgba(255,255,255,0.82)"
                    style={{ pointerEvents: 'none' }}
                  >
                    {truncate(nd.label)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Légende (natures présentes) */}
        {nodes.length > 0 && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 max-w-[70%] pointer-events-none">
            {Array.from(new Set(nodes.map((n) => n.kind))).map((kind) => (
              <span key={kind} className="flex items-center gap-1 text-[9px] font-mono text-[var(--muted)]">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: KIND_COLOR[kind], border: `1px solid ${KIND_COLOR[kind]}` }}
                />
                {KIND_LABEL[kind]}
              </span>
            ))}
          </div>
        )}

        {/* Compteur + hint */}
        {nodes.length > 0 && (
          <div className="absolute bottom-2 right-2 text-[9px] font-mono text-[var(--faint)] pointer-events-none text-right">
            {nodes.length} nœuds · {edges.length} liens
            <br />
            clic = étendre · glisser = déplacer · molette = zoom
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default memo(EntityGraphPanel);
