'use client';

// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — STORE TEMPS-RÉEL PAR-CLÉ (pattern useSyncExternalStore).
//  Store singleton en mémoire, SANS zustand/redux. Chaque "clé" est un nom
//  de couche ('aircraft', 'ships', 'earthquakes', 'satellites'…). L'intérêt :
//  un abonné à 'aircraft' ne re-render QUE quand la valeur de 'aircraft'
//  change réellement — pas quand 'ships' bouge. Ré-écriture clean-room.
// ─────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';

/** Données du store : un dictionnaire clé → valeur opaque (typée à la lecture). */
export type StoreData = Record<string, unknown>;

/** Signature d'un écouteur d'abonnement (déclenché quand SA clé change). */
type Listener = () => void;

// ── État interne du singleton ────────────────────────────────────────────
//  `data` : la dernière valeur connue par clé (comparaison par référence).
//  `listeners` : un Set d'écouteurs PAR clé (abonnement ciblé, pas global).
const data: StoreData = {};
const listeners = new Map<string, Set<Listener>>();

/** Renvoie (en le créant au besoin) le Set d'écouteurs d'une clé. */
function listenersFor(key: string): Set<Listener> {
  let set = listeners.get(key);
  if (!set) {
    set = new Set<Listener>();
    listeners.set(key, set);
  }
  return set;
}

/**
 * Fusionne un patch dans le store et NE NOTIFIE QUE les abonnés des clés
 * dont la valeur a réellement changé (comparaison de référence `!==`).
 * Si une clé du patch pointe vers la même référence qu'avant, elle est
 * ignorée — aucun re-render inutile. C'est le cœur du re-render ciblé :
 * un fetch qui renvoie un objet inchangé (ex. après un 304 mal géré, ou une
 * couche stable) ne réveille personne.
 */
export function mergeData(patch: Partial<StoreData>): void {
  const changedKeys: string[] = [];
  for (const key of Object.keys(patch)) {
    const next = patch[key];
    // Comparaison de RÉFÉRENCE : l'appelant DOIT fournir une nouvelle
    // référence quand le contenu change (ce que fait naturellement un JSON
    // fraîchement parsé). Valeur identique → on n'écrit ni ne notifie.
    if (data[key] !== next) {
      data[key] = next;
      changedKeys.push(key);
    }
  }
  // Notification APRÈS avoir écrit toutes les clés, pour que tout listener
  // réveillé lise un store déjà cohérent (toutes les clés du patch posées).
  for (const key of changedKeys) {
    const set = listeners.get(key);
    if (!set) continue;
    for (const listener of set) listener();
  }
}

/**
 * Abonne un écouteur à UNE clé. Renvoie la fonction de désabonnement
 * (signature attendue par `useSyncExternalStore`).
 */
export function subscribeKey(key: string, listener: Listener): () => void {
  const set = listenersFor(key);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/** Lit la valeur courante d'une clé (snapshot synchrone côté client). */
export function getSnapshotKey<T = unknown>(key: string): T | undefined {
  return data[key] as T | undefined;
}

/**
 * Snapshot serveur STABLE pour le SSR Next : on renvoie toujours `undefined`.
 * `useSyncExternalStore` exige un getServerSnapshot déterministe et constant
 * (pas de nouvelle référence à chaque appel) sous peine d'erreur d'hydratation.
 * Les données temps-réel n'existent pas au SSR : `undefined` est correct et
 * la valeur réelle arrive au 1er tick client.
 */
function getServerSnapshotKey(): undefined {
  return undefined;
}

/**
 * Hook React : s'abonne à UNE clé du store et re-render uniquement quand
 * la valeur de CETTE clé change. Typage à la lecture via le paramètre `T`.
 *
 * Exemple :
 *   const avions = useDataKey<Aircraft[]>('aircraft');
 */
export function useDataKey<T = unknown>(key: string): T | undefined {
  return useSyncExternalStore<T | undefined>(
    // subscribe : lié à la clé (referentiellement stable tant que key est stable).
    (listener) => subscribeKey(key, listener),
    // getSnapshot client.
    () => getSnapshotKey<T>(key),
    // getSnapshot serveur (SSR/hydratation).
    getServerSnapshotKey,
  );
}

/**
 * Vide entièrement le store et ses abonnements. Utile aux tests ou à un
 * reset de session (déconnexion). N'émet volontairement AUCUNE notification :
 * à utiliser hors cycle de rendu.
 */
export function resetStore(): void {
  for (const key of Object.keys(data)) delete data[key];
  listeners.clear();
}
