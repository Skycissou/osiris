// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — ENTITY / EXPAND : constructeur de graphe d'entités d'enquête.
//
//  RÔLE
//  ────
//  À partir d'UNE cible (domaine, IP, ASN, email, pseudo GitHub), orchestre
//  côté serveur les lookups OSINT pertinents et renvoie un PETIT graphe de
//  nœuds/liens décrivant les entités directement liées à la cible. Le client
//  (EntityGraphPanel) affiche ce graphe et rappelle cette route pour ÉTENDRE
//  un nœud au clic (exploration pas-à-pas).
//
//  ⚠️ ROUTE SOUS /entity (PAS /api) — GET /entity/expand?q=<cible>&type=<kind?>
//
//  MATIÈRE PREMIÈRE (mêmes fournisseurs PUBLICS/GRATUITS que src/app/osint/*) :
//    • DNS-over-HTTPS (dns.google)      → IP résolues d'un domaine (A/AAAA)
//    • Certificate Transparency (crt.sh) → sous-domaines émis (≤10)
//    • RDAP (rdap.org)                   → registrar d'un domaine / d'une IP
//    • BGPView (api.bgpview.io)          → ASN + opérateur d'une IP / holder ASN
//    • ipwho.is                          → opérateur / organisation d'une IP
//    • api.github.com                    → profil public d'un pseudo
//  On réutilise la MÊME logique que les routes osint : on NE fetch JAMAIS la
//  cible directement, on interroge des FOURNISSEURS FIXES via `safeFetch`
//  (garde SSRF), la cible n'étant qu'un paramètre. Clean-room : aucune ligne
//  copiée d'un autre projet, on ré-implémente les parseurs nécessaires.
//
//  DÉGRADATION DOUCE (règle d'or) : une source KO (statut, timeout, JSON) →
//  ses nœuds sont simplement OMIS, jamais de 500. Nœuds dédupliqués par `id`,
//  graphe plafonné à MAX_NODES.
//
//  CADRE DÉFENSIF ARPD : uniquement des données PUBLIQUES déjà diffusées
//  (registres, logs CT, routage BGP, profils publics). Veille / enquête légale,
//  aucun ciblage abusif, aucune donnée privée.
//
//  CONTRAT (client) :
//    GET /entity/expand?q=<cible>&type=<domaine|ip|asn|email|pseudo?>
//    → 200 {
//        seed:  { id, kind },                       // cible normalisée + son type
//        nodes: { id, label, kind, meta? }[],       // dédupliqués par id (≤ MAX_NODES)
//        edges: { source, target, label? }[],       // liens typés
//      }
//    → 200 { seed, nodes:[seed], edges:[] }         // dégradation totale (jamais 500)
//
//  Ré-écriture clean-room (calque de forme : src/app/live-feed/fast/route.ts).
//  Clés env : AUCUNE requise (GITHUB_TOKEN OPTIONNELLE — relève juste le quota).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'node:net';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : lookup à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

// ── Constantes ───────────────────────────────────────────────────────────────
/** Timeout réseau par fournisseur (ms). */
const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max acceptée pour la cible (garde-fou anti-abus, = FQDN). */
const MAX_Q_LEN = 253;
/** Plafond dur de nœuds dans le graphe renvoyé (protège le client). */
const MAX_NODES = 40;
/** Plafond de sous-domaines (nœuds cert) ajoutés pour un domaine. */
const MAX_CERT_NODES = 10;
/** User-Agent identifiant l'appelant (étiquette, cohérent avec les routes osint). */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

// ── Types du contrat ─────────────────────────────────────────────────────────
/**
 * Nature d'un nœud. Sert de clé de couleur côté client (charte V3) :
 *   domaine=accent · ip=accent-bright · asn=violet · cert=green ·
 *   person=amber · org=amber · registrar=muted · email=accent-deep.
 */
type NodeKind = 'domaine' | 'ip' | 'asn' | 'cert' | 'person' | 'org' | 'registrar' | 'email';

/** Un nœud du graphe. `id` est aussi la cible d'une ré-expansion (?q=id). */
interface GraphNode {
  id: string;
  label: string;
  kind: NodeKind;
  meta?: Record<string, string>;
}

/** Un lien orienté typé entre deux nœuds (par id). */
interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

/** Réponse complète renvoyée au client. */
interface GraphResponse {
  seed: { id: string; kind: NodeKind };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Accumulateur de graphe (dédup + cap) ─────────────────────────────────────
/**
 * Petit accumulateur : dédup des nœuds par id, cap MAX_NODES, edges déduplifiées
 * par (source|target|label). Toute la construction passe par lui → un seul point
 * qui garantit les invariants du contrat.
 */
class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];
  private edgeKeys = new Set<string>();

  /** Ajoute/complète un nœud. Renvoie false si le cap est atteint (nœud omis). */
  addNode(node: GraphNode): boolean {
    const existing = this.nodes.get(node.id);
    if (existing) {
      // Enrichit sans écraser : fusionne les métadonnées connues.
      if (node.meta) existing.meta = { ...existing.meta, ...node.meta };
      return true;
    }
    if (this.nodes.size >= MAX_NODES) return false; // cap dur → on omet en douceur
    this.nodes.set(node.id, { ...node });
    return true;
  }

  /** Ajoute un lien SEULEMENT si ses deux extrémités existent (pas de nœud fantôme). */
  addEdge(source: string, target: string, label?: string): void {
    if (source === target) return;
    if (!this.nodes.has(source) || !this.nodes.has(target)) return;
    const key = `${source}|${target}|${label ?? ''}`;
    if (this.edgeKeys.has(key)) return;
    this.edgeKeys.add(key);
    this.edges.push({ source, target, label });
  }

  hasRoom(): boolean {
    return this.nodes.size < MAX_NODES;
  }

  build(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: [...this.nodes.values()], edges: this.edges };
  }
}

// ── Détection du type de cible ───────────────────────────────────────────────
/** Regex d'un FQDN strict (mêmes règles que les routes osint whois/dns). */
const FQDN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
/** Regex d'un login GitHub (alphanumérique + tirets, ≤39). */
const GH_LOGIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,38})$/;

/**
 * Normalise + type la cible. `forced` (param ?type=) prime si cohérent, sinon
 * on infère : email > IP > ASN > domaine > pseudo. Renvoie null si inexploitable.
 */
function classify(raw: string | null, forced: string | null): { id: string; kind: NodeKind } | null {
  if (!raw) return null;
  const q = raw.trim().toLowerCase();
  if (!q || q.length > MAX_Q_LEN) return null;

  const forcedKind = normalizeKind(forced);

  // Email : présence d'un @ avec une partie domaine valide.
  if (q.includes('@')) {
    const parts = q.split('@');
    if (parts.length === 2 && parts[0] && FQDN_RE.test(parts[1])) {
      return { id: q, kind: 'email' };
    }
  }
  // IP littérale (v4/v6).
  if (isIP(q) !== 0) return { id: q, kind: 'ip' };
  // ASN explicite « ASxxxx ».
  if (/^as\d{1,10}$/.test(q)) return { id: q.toUpperCase(), kind: 'asn' };
  // Domaine (FQDN).
  if (FQDN_RE.test(q)) {
    // Un ?type=pseudo forcé sur un truc à points reste ignoré (incohérent).
    return { id: q, kind: 'domaine' };
  }
  // Sinon : pseudo GitHub (si le type forcé le confirme ou si ça ressemble à un login).
  if (GH_LOGIN_RE.test(q) && (forcedKind === 'person' || forcedKind === null)) {
    return { id: q, kind: 'person' };
  }
  return null;
}

/** Traduit le param ?type= (souple) vers un NodeKind, ou null. */
function normalizeKind(forced: string | null): NodeKind | null {
  if (!forced) return null;
  const f = forced.trim().toLowerCase();
  switch (f) {
    case 'domaine':
    case 'domain':
      return 'domaine';
    case 'ip':
      return 'ip';
    case 'asn':
      return 'asn';
    case 'email':
    case 'mail':
      return 'email';
    case 'pseudo':
    case 'person':
    case 'github':
      return 'person';
    default:
      return null;
  }
}

// ── Fetch helpers (dégradation douce systématique) ───────────────────────────
/**
 * GET JSON via safeFetch (garde SSRF). Renvoie l'objet parsé ou null sur la
 * moindre anomalie (statut, timeout, réseau, JSON invalide). NE JETTE JAMAIS.
 */
async function fetchJson<T = unknown>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 3, // rdap.org peut rediriger vers le serveur autoritaire
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Idem mais renvoie le corps texte (crt.sh renvoie parfois du texte). */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Parseurs RDAP (ré-implémentés clean-room, cf. osint/whois) ────────────────
/** Registrar RDAP : entité au rôle « registrar », nom lu via le vCard `fn`. */
function findRegistrar(entities: unknown): string | undefined {
  if (!Array.isArray(entities)) return undefined;
  for (const e of entities) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const roles = Array.isArray(o.roles) ? (o.roles as unknown[]) : [];
    if (!roles.includes('registrar')) continue;
    const vcard = o.vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const field of vcard[1] as unknown[]) {
        if (Array.isArray(field) && field[0] === 'fn' && typeof field[3] === 'string') return field[3];
      }
    }
    if (typeof o.handle === 'string') return o.handle;
  }
  return undefined;
}

// ── Providers osint (mêmes URLs que src/app/osint/*) ─────────────────────────
/** Résout les enregistrements A (IPv4) d'un domaine via dns.google. */
async function resolveA(domain: string): Promise<string[]> {
  const data = await fetchJson<{ Answer?: Array<{ type?: number; data?: string }> }>(
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`,
  );
  if (!data || !Array.isArray(data.Answer)) return [];
  const out: string[] = [];
  for (const ans of data.Answer) {
    // type 1 = A ; on ne garde que des IPv4 valides (dns.google renvoie aussi des CNAME).
    if (ans.type === 1 && typeof ans.data === 'string' && isIP(ans.data) === 4) out.push(ans.data);
  }
  return [...new Set(out)];
}

/** Sous-domaines émis pour un domaine via crt.sh (dédup, ≤ MAX_CERT_NODES). */
async function resolveSubdomains(domain: string): Promise<string[]> {
  const text = await fetchText(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`);
  if (!text || !text.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const nv = (item as Record<string, unknown>).name_value;
    if (typeof nv !== 'string') continue;
    // name_value peut lister plusieurs noms (séparés par \n) et des wildcards.
    for (const line of nv.split('\n')) {
      const name = line.trim().toLowerCase().replace(/^\*\./, '');
      if (!name || name === domain) continue; // on saute la cible elle-même
      if (!FQDN_RE.test(name)) continue;
      if (!name.endsWith(`.${domain}`)) continue; // seulement les vrais sous-domaines
      seen.add(name);
      if (seen.size >= MAX_CERT_NODES) break;
    }
    if (seen.size >= MAX_CERT_NODES) break;
  }
  return [...seen];
}

/** Registrar d'un domaine (ou d'une IP) via RDAP rdap.org. */
async function resolveRegistrar(target: string, kind: 'domain' | 'ip'): Promise<string | undefined> {
  const data = await fetchJson<Record<string, unknown>>(
    `https://rdap.org/${kind}/${encodeURIComponent(target)}`,
  );
  if (!data) return undefined;
  return findRegistrar(data.entities);
}

/** ASN + holder d'une IP via BGPView. */
async function resolveIpAsn(ip: string): Promise<{ asn?: string; holder?: string } | null> {
  const payload = await fetchJson<{
    status?: string;
    data?: { prefixes?: Array<{ asn?: { asn?: number; name?: string; description?: string } }> };
  }>(`https://api.bgpview.io/ip/${encodeURIComponent(ip)}`);
  if (!payload || payload.status !== 'ok' || !payload.data) return null;
  const first = Array.isArray(payload.data.prefixes) ? payload.data.prefixes[0] : undefined;
  const asnNum = first?.asn?.asn;
  return {
    asn: typeof asnNum === 'number' ? `AS${asnNum}` : undefined,
    holder: first?.asn?.name || first?.asn?.description || undefined,
  };
}

/** Holder d'un ASN via BGPView (pour l'expansion d'un nœud ASN). */
async function resolveAsnHolder(asn: string): Promise<string | undefined> {
  const num = asn.replace(/^as/i, '');
  const payload = await fetchJson<{
    status?: string;
    data?: { name?: string; description_short?: string };
  }>(`https://api.bgpview.io/asn/${encodeURIComponent(num)}`);
  if (!payload || payload.status !== 'ok' || !payload.data) return undefined;
  return payload.data.name || payload.data.description_short || undefined;
}

/** Opérateur / organisation d'une IP via ipwho.is. */
async function resolveIpOperator(ip: string): Promise<{ org?: string; asn?: string; country?: string } | null> {
  const data = await fetchJson<Record<string, unknown>>(`https://ipwho.is/${encodeURIComponent(ip)}`);
  if (!data || data.success === false) return null;
  const conn = (data.connection && typeof data.connection === 'object'
    ? (data.connection as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const asnRaw = conn.asn;
  return {
    org: str(conn.org) ?? str(conn.isp) ?? str(conn.domain),
    asn: asnRaw !== undefined && asnRaw !== null ? `AS${String(asnRaw)}` : undefined,
    country: str(data.country),
  };
}

/** Profil GitHub public d'un pseudo. */
async function resolveGithub(
  login: string,
): Promise<{ name?: string; company?: string; location?: string; repos?: number; followers?: number } | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
      method: 'GET',
      signal: controller.signal,
      headers,
      maxRedirects: 2,
    });
    if (!res.ok) return null;
    const u = (await res.json()) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
    return {
      name: str(u.name),
      company: str(u.company),
      location: str(u.location),
      repos: num(u.public_repos),
      followers: num(u.followers),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Constructeurs de graphe par type de cible ────────────────────────────────

/** Domaine → IP(s) (dns A), sous-domaines (crt.sh ≤10), registrar (rdap). */
async function expandDomain(g: GraphBuilder, domain: string): Promise<void> {
  // Lancés en parallèle : chacun dégrade en douceur (tableau/undefined si KO).
  const [ips, subs, registrar] = await Promise.all([
    resolveA(domain),
    resolveSubdomains(domain),
    resolveRegistrar(domain, 'domain'),
  ]);

  for (const ip of ips) {
    if (!g.hasRoom()) break;
    if (g.addNode({ id: ip, label: ip, kind: 'ip' })) g.addEdge(domain, ip, 'résout vers');
  }
  for (const sub of subs) {
    if (!g.hasRoom()) break;
    if (g.addNode({ id: sub, label: sub, kind: 'cert' })) g.addEdge(domain, sub, 'certificat');
  }
  if (registrar) {
    const id = `registrar:${registrar}`;
    if (g.addNode({ id, label: registrar, kind: 'registrar' })) g.addEdge(domain, id, 'enregistré par');
  }
}

/** IP → ASN + holder (bgp), opérateur (ipwho), registrar (rdap). */
async function expandIp(g: GraphBuilder, ip: string): Promise<void> {
  const [bgp, op, registrar] = await Promise.all([
    resolveIpAsn(ip),
    resolveIpOperator(ip),
    resolveRegistrar(ip, 'ip'),
  ]);

  // ASN : bgp prioritaire, repli sur ipwho.
  const asn = bgp?.asn ?? op?.asn;
  if (asn) {
    const meta = bgp?.holder ? { holder: bgp.holder } : undefined;
    if (g.addNode({ id: asn, label: asn, kind: 'asn', meta })) g.addEdge(ip, asn, 'appartient à l’AS');
  }
  // Opérateur / organisation (ipwho).
  if (op?.org) {
    const id = `org:${op.org}`;
    const meta = op.country ? { pays: op.country } : undefined;
    if (g.addNode({ id, label: op.org, kind: 'org', meta })) g.addEdge(ip, id, 'opéré par');
  }
  // Registrar / titulaire réseau (rdap ip).
  if (registrar) {
    const id = `registrar:${registrar}`;
    if (g.addNode({ id, label: registrar, kind: 'registrar' })) g.addEdge(ip, id, 'enregistré par');
  }
}

/** ASN → holder/opérateur (bgp). */
async function expandAsn(g: GraphBuilder, asn: string): Promise<void> {
  const holder = await resolveAsnHolder(asn);
  if (holder) {
    const id = `org:${holder}`;
    if (g.addNode({ id, label: holder, kind: 'org' })) g.addEdge(asn, id, 'opéré par');
  }
}

/** Pseudo → profil GitHub (société → nœud org). */
async function expandPseudo(g: GraphBuilder, pseudo: string): Promise<void> {
  const gh = await resolveGithub(pseudo);
  if (!gh) return;
  // Enrichit le nœud pseudo lui-même avec les métadonnées de profil.
  const meta: Record<string, string> = {};
  if (gh.name) meta.nom = gh.name;
  if (gh.location) meta.lieu = gh.location;
  if (typeof gh.repos === 'number') meta.repos = String(gh.repos);
  if (typeof gh.followers === 'number') meta.followers = String(gh.followers);
  if (Object.keys(meta).length) g.addNode({ id: pseudo, label: pseudo, kind: 'person', meta });
  // Société déclarée → nœud org.
  if (gh.company) {
    const company = gh.company.replace(/^@/, '');
    const id = `org:${company}`;
    if (g.addNode({ id, label: company, kind: 'org' })) g.addEdge(pseudo, id, 'affilié à');
  }
}

/** Email → domaine (partie après @). */
async function expandEmail(g: GraphBuilder, email: string): Promise<void> {
  const domain = email.split('@')[1];
  if (!domain || !FQDN_RE.test(domain)) return;
  if (g.addNode({ id: domain, label: domain, kind: 'domaine' })) g.addEdge(email, domain, 'domaine');
}

// ── Handler ─────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const seed = classify(
    request.nextUrl.searchParams.get('q'),
    request.nextUrl.searchParams.get('type'),
  );

  // Cible inexploitable : on renvoie un graphe vide plutôt qu'une erreur (le
  // client sait afficher « aucune entité »). Jamais de 500.
  if (!seed) {
    const empty: GraphResponse = {
      seed: { id: '', kind: 'domaine' },
      nodes: [],
      edges: [],
    };
    return NextResponse.json(empty, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }

  const g = new GraphBuilder();
  // Nœud racine : toujours présent, c'est le pivot du graphe.
  g.addNode({ id: seed.id, label: seed.id, kind: seed.kind });

  try {
    switch (seed.kind) {
      case 'domaine':
        await expandDomain(g, seed.id);
        break;
      case 'ip':
        await expandIp(g, seed.id);
        break;
      case 'asn':
        await expandAsn(g, seed.id);
        break;
      case 'email':
        await expandEmail(g, seed.id);
        break;
      case 'person':
        await expandPseudo(g, seed.id);
        break;
      default:
        break; // kinds dérivés (cert/org/registrar) : pas d'expansion propre
    }
  } catch {
    // Filet ultime : une exception inattendue ne doit jamais casser la route.
    // Le nœud racine reste renvoyé seul (dégradation totale).
  }

  const { nodes, edges } = g.build();
  const body: GraphResponse = { seed, nodes, edges };
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
