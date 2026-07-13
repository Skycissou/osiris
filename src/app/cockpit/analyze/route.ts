// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — ANALYZE : briefing de situation IA à partir du contexte carte.
//
//  RÔLE : produire un COURT briefing en français décrivant la situation visible
//  sur la carte (couches actives, nombre d'entités par couche, éventuelles
//  entités notables, zone). Le briefing est demandé à un LLM via la clé de
//  L'UTILISATEUR ; en l'absence de clé (ou si le LLM échoue), un briefing DE
//  REPLI déterministe est généré côté serveur SANS IA. JAMAIS de 500.
//
//  ⚠️ ROUTAGE CRITIQUE : cette route vit sous /analyze et JAMAIS sous /api/*.
//  En prod/staging Traefik strippe /api/* vers l'ancien backend FastAPI → une
//  route /api/* renverrait 404. On calque donc le squelette des routes maison
//  (/news, /osint/whois, /osint/shodan) : force-dynamic, no-store, keyOf pour
//  la clé, safeFetch (garde SSRF) vers un endpoint LLM FIXE, dégradation douce.
//
//  FOURNISSEUR LLM : endpoint FIXE et connu (pas d'URL fournie par l'utilisateur,
//  donc pas de surface SSRF côté cible). Structure compatible OpenAI « chat
//  completions ». Défaut : OpenRouter. Le modèle est configurable via env.
//    • clé      : en-tête `x-osiris-key-llm`  (repli env LLM_API_KEY)
//    • provider : en-tête `x-osiris-key-llm-provider` (repli env LLM_PROVIDER,
//                 défaut 'openrouter')
//    • modèle   : env LLM_MODEL (défaut 'openai/gpt-4o-mini')
//
//  CONTRAT (client) :
//    POST /analyze
//      body JSON { context: { layers: string[]; counts?: Record<string,number>;
//                             entities?: any[]; bbox?: number[]; place?: string } }
//    → 200 { briefing: string, ai: boolean, provider?: string }
//        • ai=true  → le LLM a répondu
//        • ai=false → briefing de repli déterministe (aucune clé / LLM en échec)
//    Jamais de 500.
//
//  CADRE DÉFENSIF ARPD : analyse de SITUATION à partir de données PUBLIQUES déjà
//  agrégées sur la carte. Aucun ciblage de personne, aucune donnée privée. Le
//  prompt encadre explicitement le LLM en ce sens.
//
//  Ré-écriture clean-room (calque : src/app/news/route.ts,
//  src/app/osint/shodan/route.ts) : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : briefing à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';
// Handler Node.js (safeFetch s'appuie sur les DNS/sockets Node — pas de runtime edge).
export const runtime = 'nodejs';

/** Timeout réseau vers le fournisseur LLM (ms). */
const FETCH_TIMEOUT_MS = 20_000;
/** Modèle LLM par défaut (surchargé par l'env LLM_MODEL). */
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
/** Fournisseur LLM par défaut si rien n'est précisé. */
const DEFAULT_PROVIDER = 'openrouter';
/** Plafonds défensifs sur le contexte reçu (anti-abus / anti-explosion de prompt). */
const MAX_LAYERS = 40;
const MAX_ENTITIES = 40;
const MAX_LABEL_LEN = 120;
/** User-Agent identifiant l'appelant (cohérent avec les autres routes). */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/** Contexte carte reçu du client (tout est optionnel sauf layers). */
interface BriefingContext {
  layers: string[];
  counts?: Record<string, number>;
  entities?: unknown[];
  bbox?: number[];
  place?: string;
}

/** Réponse normalisée renvoyée au client. */
interface BriefingResult {
  briefing: string;
  ai: boolean;
  provider?: string;
}

/**
 * Clé effective d'un service. Priorité à l'en-tête HTTP fourni par l'utilisateur
 * (`x-osiris-key-<service>`) — Cissou peut ainsi renseigner sa clé depuis l'app
 * sans redéployer — sinon repli sur la variable d'env. '' si ni l'un ni l'autre
 * (dégradation douce : sans clé, on bascule sur le briefing de repli, jamais 500).
 */
const keyOf = (req: Request, service: string, env?: string) =>
  req.headers.get(`x-osiris-key-${service}`) || (env ? process.env[env] : undefined) || '';

/** Renvoie une chaîne courte et nettoyée (borne de longueur), ou undefined. */
function shortStr(v: unknown, max = MAX_LABEL_LEN): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

/**
 * Normalise/sanitize le contexte reçu (défensif) : on ne garde que des champs
 * de forme attendue et bornée, pour ne pas gonfler le prompt ni faire confiance
 * aveuglément au corps de requête.
 */
function sanitizeContext(raw: unknown): BriefingContext {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const layers = Array.isArray(o.layers)
    ? o.layers
        .map((l) => shortStr(l, 60))
        .filter((l): l is string => !!l)
        .slice(0, MAX_LAYERS)
    : [];

  let counts: Record<string, number> | undefined;
  if (o.counts && typeof o.counts === 'object') {
    counts = {};
    for (const [k, v] of Object.entries(o.counts as Record<string, unknown>)) {
      const key = shortStr(k, 60);
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
      if (key && n !== null) counts[key] = n;
    }
    if (Object.keys(counts).length === 0) counts = undefined;
  }

  const bbox = Array.isArray(o.bbox)
    ? o.bbox.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : null)).filter((n): n is number => n !== null)
    : undefined;

  const entities = Array.isArray(o.entities) ? o.entities.slice(0, MAX_ENTITIES) : undefined;

  return {
    layers,
    counts,
    entities: entities && entities.length ? entities : undefined,
    bbox: bbox && bbox.length === 4 ? bbox : undefined,
    place: shortStr(o.place),
  };
}

/**
 * Extrait un libellé lisible d'une entité (forme libre). On tente quelques clés
 * usuelles (label, name, title, value) sans faire d'hypothèse forte sur le schéma.
 */
function entityLabel(e: unknown): string | undefined {
  if (typeof e === 'string') return shortStr(e);
  if (!e || typeof e !== 'object') return undefined;
  const o = e as Record<string, unknown>;
  return (
    shortStr(o.label) ||
    shortStr(o.name) ||
    shortStr(o.title) ||
    shortStr(o.value) ||
    undefined
  );
}

/**
 * Construit un résumé factuel FR du contexte (couches, counts, zone, entités).
 * Sert À LA FOIS de corps du briefing de repli ET de matière factuelle injectée
 * dans le prompt LLM. Purement déterministe, aucun réseau.
 */
function describeContext(ctx: BriefingContext): string {
  const lignes: string[] = [];

  // Zone.
  if (ctx.place) {
    lignes.push(`Zone : ${ctx.place}.`);
  } else if (ctx.bbox) {
    const [a, b, c, d] = ctx.bbox;
    lignes.push(`Emprise (bbox) : ${a}, ${b}, ${c}, ${d}.`);
  }

  // Couches actives.
  if (ctx.layers.length) {
    lignes.push(`Couches actives (${ctx.layers.length}) : ${ctx.layers.join(', ')}.`);
  } else {
    lignes.push('Aucune couche active signalée.');
  }

  // Décompte par couche.
  if (ctx.counts) {
    const parts = Object.entries(ctx.counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`);
    if (parts.length) {
      const total = Object.values(ctx.counts).reduce((s, n) => s + n, 0);
      lignes.push(`Entités visibles (${total}) : ${parts.join(', ')}.`);
    }
  }

  // Entités notables (libellés seulement).
  if (ctx.entities) {
    const labels = ctx.entities
      .map(entityLabel)
      .filter((l): l is string => !!l)
      .slice(0, 12);
    if (labels.length) {
      lignes.push(`Éléments notables : ${labels.join(' · ')}.`);
    }
  }

  return lignes.join('\n');
}

/**
 * Briefing DE REPLI (aucune IA) : résumé déterministe FR à partir du contexte.
 * Toujours renvoyé en 200 avec ai:false. C'est le filet de sécurité quand aucune
 * clé n'est configurée ou que le LLM échoue.
 */
function fallbackBriefing(ctx: BriefingContext): string {
  const faits = describeContext(ctx);
  return (
    'Briefing de situation (mode basique, sans IA)\n' +
    '───────────────────────────────────────────\n' +
    `${faits}\n\n` +
    'Aucune clé IA configurée (ou service indisponible) — briefing factuel automatique. ' +
    'Renseigne une clé LLM dans le module « Clés API » pour un briefing rédigé et analysé. ' +
    'Cadre ARPD : analyse de situation sur données publiques, aucun ciblage de personne.'
  );
}

/**
 * Prompt SYSTÈME : cadre défensif ARPD + consignes de forme (FR, court, structuré).
 */
function systemPrompt(): string {
  return [
    "Tu es un analyste de situation pour l'ARPD (association de police), dans un cadre STRICTEMENT DÉFENSIF et légal.",
    'Tu travailles UNIQUEMENT à partir de données PUBLIQUES déjà agrégées sur une carte de veille.',
    'RÈGLES ABSOLUES :',
    "- Tu NE cibles JAMAIS une personne, tu NE désignes JAMAIS d'individu, tu NE proposes AUCUNE action offensive ou intrusive.",
    "- Tu restes au niveau SITUATIONNEL (tendances, concentrations, points d'attention de veille).",
    '- Tu réponds INTÉGRALEMENT en français, de façon SOBRE et FACTUELLE, sans extrapoler au-delà des données fournies.',
    'FORME ATTENDUE (briefing COURT) :',
    "1) Une phrase de synthèse. 2) 2 à 4 puces de points saillants (couches, volumes, zone). 3) Une puce « À surveiller » prudente.",
    'Pas de préambule, pas de conclusion bavarde. 120 mots maximum.',
  ].join('\n');
}

/**
 * Prompt UTILISATEUR : les faits déterministes du contexte carte.
 */
function userPrompt(ctx: BriefingContext): string {
  return (
    "Voici l'état actuel de la carte de veille OSIRIS. Rédige le briefing de situation demandé.\n\n" +
    describeContext(ctx)
  );
}

/**
 * Résout l'endpoint chat-completions du fournisseur. FIXE et connu (aucune URL
 * utilisateur) → pas de surface SSRF côté cible. Seul OpenRouter est câblé par
 * défaut ; un provider inconnu retombe sur OpenRouter (structure OpenAI commune).
 */
function providerEndpoint(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'openrouter':
    default:
      return 'https://openrouter.ai/api/v1/chat/completions';
  }
}

/**
 * Appelle le LLM (structure OpenAI chat completions). Renvoie le texte du
 * briefing en cas de succès, ou null en cas d'échec (timeout, erreur HTTP, JSON
 * illisible, contenu vide) — l'appelant bascule alors sur le repli. Ne throw pas.
 */
async function callLlm(
  provider: string,
  key: string,
  model: string,
  ctx: BriefingContext,
): Promise<string | null> {
  const endpoint = providerEndpoint(provider);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'User-Agent': USER_AGENT,
        // En-têtes de courtoisie OpenRouter (facultatifs, ignorés ailleurs).
        'HTTP-Referer': 'https://osiris.cissouhub.cloud',
        'X-Title': 'OSIRIS Cockpit',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: userPrompt(ctx) },
        ],
      }),
      maxRedirects: 2,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = data?.choices?.[0]?.message?.content;
    const text = typeof content === 'string' ? content.trim() : '';
    return text ? text : null;
  } catch {
    // Timeout / réseau / JSON illisible → repli côté appelant.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  // Lecture défensive du corps : un JSON illisible ne doit pas faire un 500.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const rawCtx = (body && typeof body === 'object' ? (body as Record<string, unknown>).context : null) ?? {};
  const ctx = sanitizeContext(rawCtx);

  // Provider : en-tête user → env → défaut. Normalisé en minuscule.
  const provider = (
    keyOf(request, 'llm-provider', 'LLM_PROVIDER') || DEFAULT_PROVIDER
  )
    .trim()
    .toLowerCase();

  // Clé effective : en-tête `x-osiris-key-llm` OU env LLM_API_KEY.
  const key = keyOf(request, 'llm', 'LLM_API_KEY');
  const model = (process.env.LLM_MODEL || DEFAULT_MODEL).trim();

  // Sans clé → repli déterministe immédiat (aucun appel réseau).
  if (!key) {
    return NextResponse.json(
      { briefing: fallbackBriefing(ctx), ai: false } satisfies BriefingResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Avec clé → tentative LLM, repli si échec (jamais de 500).
  const text = await callLlm(provider, key, model, ctx);
  if (text) {
    return NextResponse.json(
      { briefing: text, ai: true, provider } satisfies BriefingResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    { briefing: fallbackBriefing(ctx), ai: false, provider } satisfies BriefingResult,
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
