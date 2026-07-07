// ─────────────────────────────────────────────────────────────────────────────
//  gdeltGate.ts — PORTIER unique vers api.gdeltproject.org (serveur only)
//
//  POURQUOI (diagnostic VPS du 07/07, script test-couches) : GDELT impose
//  « 1 requête toutes les 5 secondes par IP » (réponse 429 explicite) et
//  ralentit les IP insistantes → les appels directs de /news et de la couche
//  géopolitique (/live-feed/slow) se marchaient dessus → timeouts en cascade.
//
//  CE QUE FAIT LE PORTIER (pour TOUTES les routes qui parlent à GDELT) :
//    1. FILE UNIQUE  : les appels GDELT sont sérialisés, espacés d'au moins
//       5,5 s (leur règle + marge) — plus jamais deux requêtes simultanées.
//    2. CACHE 5 min  : même URL redemandée → réponse mémoire, zéro réseau.
//       (Les news/événements géopolitiques bougent lentement, 5 min suffisent.)
//    3. STALE-ON-ERROR : GDELT en panne/quota → on sert la dernière réponse
//       connue (périmée) plutôt qu'un panneau vide.
//    4. TIMEOUT 20 s : GDELT est lent aux heures de pointe (>9 s fréquent).
//
//  Le cache vit dans la mémoire du process Next (standalone, 1 process) —
//  perdu au restart du conteneur, ce qui est exactement la durée de vie voulue.
// ─────────────────────────────────────────────────────────────────────────────

import { safeFetch } from '@/lib/ssrf-guard';
import { recordCall } from '@/lib/telemetry';

/** Durée de fraîcheur d'une réponse en cache. */
const TTL_MS = 5 * 60_000;
/** Espacement minimal entre deux requêtes GDELT (règle amont 5 s + marge). */
const MIN_INTERVAL_MS = 5_500;
/** Timeout réseau par requête (GDELT dépasse souvent 9 s en pointe). */
const TIMEOUT_MS = 20_000;
/** Garde-fou mémoire : nb max d'URLs distinctes en cache (FIFO). */
const MAX_CACHE_ENTRIES = 40;

interface GateEntry {
  ts: number;
  status: number;
  text: string;
}

const cache = new Map<string, GateEntry>();
let lastCallAt = 0;
/** Chaîne de sérialisation : chaque appel s'accroche au précédent. */
let chain: Promise<void> = Promise.resolve();

export interface GdeltResult {
  /** Code HTTP amont (200, 429…). */
  status: number;
  /** Corps brut (JSON ou message d'erreur GDELT). */
  text: string;
  /** true = réponse PÉRIMÉE servie faute de mieux (amont en erreur). */
  stale: boolean;
}

/**
 * Récupère une URL GDELT en respectant quota + cache. Renvoie null uniquement
 * si l'amont est injoignable ET qu'aucune réponse antérieure n'existe.
 */
export async function gdeltFetch(url: string, userAgent: string): Promise<GdeltResult | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return { status: hit.status, text: hit.text, stale: false };
  }

  let fresh: GateEntry | null = null;
  await (chain = chain.then(async () => {
    // Un appel concurrent (mis en file avant nous) a pu remplir le cache.
    const again = cache.get(url);
    if (again && Date.now() - again.ts < TTL_MS) {
      fresh = again;
      return;
    }
    // Respecte l'espacement minimal depuis le DERNIER appel réseau GDELT.
    const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();
    try {
      const res = await safeFetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': userAgent },
        maxRedirects: 2,
      });
      const text = await res.text();
      fresh = { ts: Date.now(), status: res.status, text };
      recordCall({ source: 'gdelt-doc', ok: res.ok, status: res.status, ms: Date.now() - started });
      // Seules les réponses OK méritent le cache (un 429 ne doit pas coller).
      if (res.ok) {
        cache.set(url, fresh);
        if (cache.size > MAX_CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
      }
    } catch (e) {
      fresh = null; // réseau/timeout → on tentera le stale ci-dessous
      recordCall({ source: 'gdelt-doc', ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
    } finally {
      clearTimeout(timeout);
    }
  }));

  if (fresh) return { status: (fresh as GateEntry).status, text: (fresh as GateEntry).text, stale: false };
  if (hit) return { status: hit.status, text: hit.text, stale: true };
  return null;
}
