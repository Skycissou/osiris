// ─────────────────────────────────────────────────────────────────────────────
//  uiTelemetryTypes.ts — Contrat PARTAGÉ client ↔ serveur (pur, sans I/O)
//  Spec Claude 07/07 (§3, §4). Whitelist des types d'événements + plafonds.
// ─────────────────────────────────────────────────────────────────────────────

/** Types d'événements autorisés (rejet strict de tout autre à l'ingest). */
export const UI_EVENT_TYPES = [
  'layer_toggle',
  'layer_filter',
  'search',
  'osint_lookup',
  'news_click',
  'entity_open',
  'graph_action',
  'preset_apply',
  'shortcut',
  'share_create',
  'apikey_save',
  'map_move',
  'page',
  'fetch',
  'js_error',
  'promise_reject',
] as const;

export type UiEventType = (typeof UI_EVENT_TYPES)[number];

export const UI_EVENT_TYPE_SET: ReadonlySet<string> = new Set(UI_EVENT_TYPES);

/** Plafonds (appliqués côté client ET re-appliqués côté serveur). */
export const CAPS = {
  batchBytes: 32 * 1024, // payload max
  eventsPerBatch: 100, // events max / POST
  bufferMax: 200, // buffer client (drop des plus vieux)
  qLen: 200, // longueur max d'une requête `q`
  msgLen: 300, // longueur max d'un message d'erreur
  strLen: 200, // longueur max d'une string de détail générique
} as const;

/** Un événement tel qu'émis par le client. */
export interface UiEvent {
  t: string; // type (validé contre la whitelist)
  at: number; // horloge client (ms)
  d: Record<string, unknown>; // détail
}

/** Tronque une string à une longueur max (null-safe). */
export function trunc(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}
