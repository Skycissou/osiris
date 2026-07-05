'use client';

// ─────────────────────────────────────────────────────────────────────────────
//  analyzeClient.ts — Client de la route /analyze (OSIRIS V4 · cockpit)
//  Agent IA ANALYSE / BRIEFING
//
//  RÔLE
//  ────
//  Demande à la route interne POST /analyze un briefing de situation FR à partir
//  du contexte carte courant (couches actives, décomptes, entités notables, zone).
//  La route dégrade en douceur : sans clé LLM configurée (ou LLM en échec) elle
//  renvoie un briefing DE REPLI déterministe (ai:false). Ce client ne throw
//  JAMAIS : toute erreur devient un BriefingResult de repli local.
//
//  BASE PATH (cohérence osintClient / NewsPanel / liveData) : le cockpit tourne
//  éventuellement sous un préfixe (ex. /cockpit). La route /analyze est INTERNE
//  à Next → l'URL est préfixée par process.env.NEXT_PUBLIC_BASE_PATH, comme les
//  appels /news et /osint/* des autres clients.
//
//  ⚠️ ROUTAGE : la route vit sous /analyze et JAMAIS sous /api/* (Traefik strippe
//  /api/* vers l'ancien backend FastAPI en prod → 404). Ne pas préfixer /api.
//
//  CLÉ LLM (en-tête `x-osiris-key-llm`) :
//  Convention partagée (voir src/lib/apiKeys.ts) : localStorage `osiris-apikey-<svc>`
//  → en-tête `x-osiris-key-<svc>`. Le service 'llm' n'existe PAS ENCORE dans le
//  type `ApiKeyService` d'apiKeys.ts. En attendant que le chef l'y ajoute, ce
//  client lit directement localStorage `osiris-apikey-llm` via un petit helper
//  SSR-safe local (même pattern que safeStorage d'apiKeys.ts) et pose l'en-tête
//  lui-même. Idem pour le provider (`osiris-apikey-llm-provider`).
//  ➡️ MIGRATION : une fois 'llm' (et 'llm-provider') ajoutés à ApiKeyService, on
//     pourra remplacer readLocalKey('llm') par keyHeaders(['llm']) d'apiKeys.ts.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

// ── Contrat (miroir de la route /analyze) ────────────────────────────────────
/** Contexte carte envoyé à /analyze (tout est optionnel sauf layers). */
export interface BriefingContext {
  layers: string[];
  counts?: Record<string, number>;
  entities?: unknown[];
  bbox?: number[];
  place?: string;
}

/** Réponse normalisée de /analyze. `ai` = true si le LLM a répondu, false = repli. */
export interface BriefingResult {
  briefing: string;
  ai: boolean;
  provider?: string;
}

// ── Base path + garde-fous ───────────────────────────────────────────────────
/** Préfixe de route Next (cohérent avec osintClient / NewsPanel). Défaut ''. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Timeout local de l'appel /analyze (ms) — un peu au-dessus du timeout serveur. */
const DEFAULT_TIMEOUT_MS = 25_000;

/** Préfixe localStorage (convention partagée avec apiKeys.ts). */
const STORAGE_PREFIX = 'osiris-apikey-';
/** Préfixe des en-têtes HTTP (convention partagée avec apiKeys.ts). */
const HEADER_PREFIX = 'x-osiris-key-';

/**
 * Garde SSR : localStorage n'existe pas côté serveur (Next SSR) ni si l'accès est
 * bloqué (mode privé strict). Jamais de throw — on retombe sur un comportement
 * neutre. Copie du pattern safeStorage d'apiKeys.ts (le service 'llm' n'y est pas
 * encore, on ne peut donc pas encore réutiliser getKey/keyHeaders).
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Lit une clé localStorage `osiris-apikey-<service>`. '' si absente / SSR / erreur.
 * Ne throw jamais. (Helper local temporaire — voir note de migration en tête.)
 */
function readLocalKey(service: string): string {
  const store = safeStorage();
  if (!store) return '';
  try {
    return store.getItem(`${STORAGE_PREFIX}${service}`) ?? '';
  } catch {
    return '';
  }
}

/**
 * Construit les en-têtes clé/provider pour /analyze. On pose `x-osiris-key-llm`
 * et, si un provider est stocké, `x-osiris-key-llm-provider`. Une clé absente est
 * simplement omise (le serveur retombe alors sur son repli déterministe).
 */
function llmHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = readLocalKey('llm');
  if (key) headers[`${HEADER_PREFIX}llm`] = key;
  const provider = readLocalKey('llm-provider');
  if (provider) headers[`${HEADER_PREFIX}llm-provider`] = provider;
  return headers;
}

/** Construit l'URL interne préfixée par le basePath (jamais /api, jamais d'origine absolue). */
function buildAnalyzeUrl(): string {
  const prefix = BASE_PATH.replace(/\/$/, '');
  return `${prefix}/analyze`;
}

/**
 * Repli LOCAL (si même la requête réseau échoue) : bref message FR cohérent avec
 * le contrat, ai:false. On évite ainsi tout throw remontant à l'UI.
 */
function localFallback(ctx: BriefingContext): BriefingResult {
  const nbLayers = Array.isArray(ctx.layers) ? ctx.layers.length : 0;
  const total = ctx.counts
    ? Object.values(ctx.counts).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0)
    : 0;
  return {
    briefing:
      'Briefing indisponible (échec de la requête). ' +
      `État connu : ${nbLayers} couche(s) active(s), ${total} entité(s) visible(s). ` +
      'Réessaie, ou renseigne une clé LLM dans le module « Clés API ». ' +
      'Cadre ARPD : analyse de situation sur données publiques, aucun ciblage.',
    ai: false,
  };
}

/**
 * requestBriefing — POST le contexte carte vers /analyze et renvoie le briefing.
 * Ne throw JAMAIS : toute erreur (réseau, timeout, HTTP ≠ 2xx, JSON illisible)
 * est convertie en BriefingResult de repli local (ai:false).
 *
 * @param ctx    contexte carte courant (fourni par le composant via une closure)
 * @param signal AbortSignal optionnel (ex. démontage du panneau) — combiné au
 *               timeout interne.
 */
export async function requestBriefing(
  ctx: BriefingContext,
  signal?: AbortSignal,
): Promise<BriefingResult> {
  const url = buildAnalyzeUrl();

  // Timeout local ; si l'appelant fournit un signal, on abandonne au 1er des deux.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...llmHeaders(),
      },
      body: JSON.stringify({ context: ctx }),
      signal: controller.signal,
    });

    if (!res.ok) return localFallback(ctx);

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return localFallback(ctx);
    }
    if (!body || typeof body !== 'object') return localFallback(ctx);

    const o = body as Record<string, unknown>;
    const briefing = typeof o.briefing === 'string' && o.briefing.trim() ? o.briefing : '';
    if (!briefing) return localFallback(ctx);

    return {
      briefing,
      ai: o.ai === true,
      provider: typeof o.provider === 'string' ? o.provider : undefined,
    };
  } catch {
    // Timeout / abort / réseau → repli local (jamais de throw).
    return localFallback(ctx);
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
