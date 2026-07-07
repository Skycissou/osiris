// ─────────────────────────────────────────────────────────────────────────────
//  serverKeyStore.ts — Coffre de clés CÔTÉ SERVEUR (persistant, hors git)
//
//  POURQUOI (retour Cissou 07/07) : un vrai utilisateur ne peut pas faire du SSH
//  ni éditer un .env. Les clés « couches » (OpenSky, FIRMS, AIS) alimentent des
//  couches PARTAGÉES et, pour OpenSky, un COLLECTEUR qui tourne en permanence
//  côté serveur (sans requête) → elles doivent vivre côté serveur.
//
//  L'opérateur les saisit UNE fois via la page admin (/cockpit/admin, protégée
//  par token) → écrites ICI dans un fichier JSON du volume persistant → lues par
//  le collecteur et les routes. Survivent aux redémarrages, zéro SSH.
//
//  SÉCURITÉ : fichier hors git, dans le volume Docker (mode 0600). La VALEUR
//  n'est JAMAIS renvoyée au client (seulement présence + longueur). Même niveau
//  de risque qu'un .env (texte clair sur disque serveur), cohérent avec l'existant.
//
//  Chemin : env OSIRIS_KEYS_DIR (défaut <cwd>/data). Fichier : server-keys.json.
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Services « couches » gérés côté serveur (le reste = clés perso, navigateur). */
export const SERVER_MANAGED_SERVICES = [
  'opensky_id',
  'opensky_secret',
  'firms',
  'ais_url',
  'ais_key',
] as const;
export type ServerManagedService = (typeof SERVER_MANAGED_SERVICES)[number];
const ALLOWED: ReadonlySet<string> = new Set(SERVER_MANAGED_SERVICES);

/** Valeur max stockée par clé (garde-fou). */
const MAX_VALUE_LEN = 4096;

function keysFile(): string {
  const dir = process.env.OSIRIS_KEYS_DIR || path.join(process.cwd(), 'data');
  return path.join(dir, 'server-keys.json');
}

// Cache mémoire (protégé HMR/dev), pour une lecture SYNCHRONE par le collecteur.
const G = globalThis as unknown as { __osirisServerKeys?: Record<string, string> | null };
if (G.__osirisServerKeys === undefined) G.__osirisServerKeys = null;

/** Charge le coffre en mémoire (idempotent). Ne throw jamais. */
export async function ensureKeysLoaded(): Promise<void> {
  if (G.__osirisServerKeys) return;
  try {
    const raw = await fs.readFile(keysFile(), 'utf8').catch(() => '');
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (ALLOWED.has(k) && typeof v === 'string' && v) clean[k] = v;
    }
    G.__osirisServerKeys = clean;
  } catch {
    G.__osirisServerKeys = {};
  }
}

/** Lecture SYNCHRONE d'une clé du coffre (vide si non chargé/absent). */
export function getServerKey(service: string): string {
  return (G.__osirisServerKeys && G.__osirisServerKeys[service]) || '';
}

/**
 * Enregistre/efface des clés du coffre (partial : valeur vide/null = suppression).
 * N'accepte que les services « couches » gérés côté serveur. Best-effort disque.
 */
export async function setServerKeys(partial: Record<string, string | null | undefined>): Promise<void> {
  await ensureKeysLoaded();
  const c = { ...(G.__osirisServerKeys ?? {}) };
  for (const [k, v] of Object.entries(partial)) {
    if (!ALLOWED.has(k)) continue; // jamais de service hors whitelist
    const val = typeof v === 'string' ? v.trim() : '';
    if (!val) delete c[k];
    else c[k] = val.slice(0, MAX_VALUE_LEN);
  }
  G.__osirisServerKeys = c;
  const dir = path.dirname(keysFile());
  await fs.mkdir(dir, { recursive: true });
  // mode 0600 : lisible par le seul propriétaire du process.
  await fs.writeFile(keysFile(), JSON.stringify(c), { encoding: 'utf8', mode: 0o600 });
}

/** Statut (présence + longueur, JAMAIS la valeur) des services gérés. */
export function serverKeyStatus(): { service: string; present: boolean; len: number }[] {
  return SERVER_MANAGED_SERVICES.map((s) => {
    const v = getServerKey(s);
    return { service: s, present: v.length > 0, len: v.length };
  });
}
