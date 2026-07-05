/**
 * forms.ts — Configuration des « formes » d'OSIRIS + gestion du consentement.
 * ---------------------------------------------------------------------------
 * Fichier CLEAN-ROOM, licence MIT (repo OSIRIS). Aucune dépendance externe.
 *
 * CONTEXTE — les deux formes d'OSIRIS
 *   OSIRIS s'exécute sous l'une de deux « formes » d'usage, choisie au BUILD via
 *   la variable d'environnement publique `NEXT_PUBLIC_OSIRIS_FORM` :
 *
 *     • Forme ① TOUT-PUBLIC  (valeur '1', DÉFAUT)
 *         → destinée à l'ARPD / au grand public. Seules les couches `form: 1`
 *           du registre (voir `layerRegistry.ts`) sont utilisables. Les couches
 *           `sensitive` / `form: 2` ne sont JAMAIS servies, même déclarées.
 *
 *     • Forme ② PERSO / ENQUÊTEUR  (valeur '2')
 *         → débloque EN PLUS les couches sensibles (VIP, CCTV, brouillage,
 *           scanners…), mais UNIQUEMENT après un consentement explicite et
 *           révocable de l'utilisateur (voir plus bas + `ConsentModal.tsx`).
 *
 *   Deux verrous distincts, cumulatifs, pour une couche sensible :
 *     1. la BUILD doit être en forme 2  (`isForm2Enabled()` === true) ;
 *     2. l'utilisateur doit AVOIR CONSENTI  (`hasConsented()` === true).
 *   `canUseLayer()` ne teste que le verrou n°1 (statique / forme). Le verrou n°2
 *   (consentement runtime) est géré par l'UI via `hasConsented()` avant
 *   d'activer réellement une couche sensible. Cette séparation est VOULUE :
 *   la forme est une propriété de build immuable, le consentement est un choix
 *   utilisateur qui peut changer à tout moment.
 *
 * NB : `NEXT_PUBLIC_OSIRIS_FORM` est inlinée par Next.js au build. On la lit
 *   donc une seule fois, au chargement du module.
 */

// ──────────────────────────────────────────────────────────────────────────
//  Type minimal accepté par les helpers de forme
// ──────────────────────────────────────────────────────────────────────────

/**
 * Forme minimale d'une couche pour les tests de forme. Volontairement un
 * sous-ensemble structurel de `LayerDef` (layerRegistry.ts) afin de rester
 * découplé : on n'importe PAS le registre ici, on accepte tout objet qui
 * expose `form` et/ou `sensitive`.
 */
export interface FormAwareLayer {
  /** 1 = tout-public · 2 = perso/enquêteur. Absent ⇒ traité comme tout-public. */
  form?: number;
  /** true = couche à usage restreint (forme 2 uniquement). */
  sensitive?: boolean;
}

// ──────────────────────────────────────────────────────────────────────────
//  Forme active (résolue au build via NEXT_PUBLIC_OSIRIS_FORM)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Résout la forme depuis l'environnement. Toute valeur autre que '2' — y
 * compris absente, vide ou invalide — retombe sur la forme 1 (tout-public).
 * Choix DÉFENSIF : en cas de doute, on sert la forme la plus restrictive.
 */
function resolveForm(): 1 | 2 {
  const raw = (process.env.NEXT_PUBLIC_OSIRIS_FORM ?? '1').trim();
  return raw === '2' ? 2 : 1;
}

/** Forme active de cette build d'OSIRIS. Immuable pour toute la session. */
export const OSIRIS_FORM: 1 | 2 = resolveForm();

/** true si la build tourne en forme 2 (perso / enquêteur). */
export function isForm2Enabled(): boolean {
  return OSIRIS_FORM === 2;
}

// ──────────────────────────────────────────────────────────────────────────
//  Verrou n°1 — utilisabilité d'une couche selon la FORME (statique)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Indique si une couche est utilisable DANS LA FORME COURANTE.
 *
 *   • Couche tout-public (`form` !== 2 et non `sensitive`) → toujours true.
 *   • Couche sensible / `form: 2` → true UNIQUEMENT si la build est en forme 2.
 *
 * ⚠️ Ce helper ne teste PAS le consentement runtime : une couche sensible peut
 *    être « utilisable » (forme 2 active) tout en restant bloquée tant que
 *    l'utilisateur n'a pas consenti. L'UI combine les deux :
 *        canUseLayer(layer) && (!isSensitive(layer) || hasConsented())
 */
export function canUseLayer(layer: FormAwareLayer): boolean {
  const isSensitive = layer.sensitive === true || layer.form === 2;
  if (!isSensitive) return true; // couche tout-public : toujours OK
  return isForm2Enabled(); // couche sensible : réservée à la forme 2
}

/** Raccourci lisible : la couche relève-t-elle de la forme 2 (sensible) ? */
export function isSensitiveLayer(layer: FormAwareLayer): boolean {
  return layer.sensitive === true || layer.form === 2;
}

// ──────────────────────────────────────────────────────────────────────────
//  Verrou n°2 — CONSENTEMENT explicite (runtime, persistant, révocable)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Clé de persistance du consentement dans `localStorage`.
 * On stocke un petit JSON `{ consented: true, date: ISO }` plutôt qu'un simple
 * booléen, pour garder une trace DATÉE du consentement (traçabilité / RGPD, et
 * utile si on veut plus tard faire expirer un vieux consentement).
 */
export const CONSENT_STORAGE_KEY = 'osiris-form2-consent';

/** Structure sérialisée dans localStorage sous CONSENT_STORAGE_KEY. */
export interface ConsentRecord {
  /** true si l'utilisateur a explicitement accepté les couches sensibles. */
  consented: boolean;
  /** Date ISO 8601 du consentement (ou de la dernière révocation). */
  date: string;
}

/**
 * Accès défensif à localStorage : renvoie null côté serveur (SSR/Next.js) ou
 * si le stockage est indisponible (mode privé, quota, navigateur bridé). On ne
 * jette JAMAIS : l'absence de storage = pas de consentement, donc sensible
 * bloqué — comportement le plus sûr.
 */
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Lit l'enregistrement de consentement brut (ou null si absent / illisible).
 * Toute erreur de parsing est traitée comme « pas de consentement ».
 */
export function getConsentRecord(): ConsentRecord | null {
  const store = safeLocalStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentRecord>;
    if (parsed && parsed.consented === true && typeof parsed.date === 'string') {
      return { consented: true, date: parsed.date };
    }
    return null;
  } catch {
    return null; // JSON corrompu → considéré comme non-consenti
  }
}

/**
 * L'utilisateur a-t-il donné son consentement aux couches sensibles ?
 * DÉFENSIF : false par défaut (SSR, storage indispo, jamais consenti, révoqué).
 * Le consentement est donc un OPT-IN strict : il faut une action positive.
 */
export function hasConsented(): boolean {
  return getConsentRecord()?.consented === true;
}

/**
 * Enregistre un consentement EXPLICITE et daté. À appeler uniquement depuis le
 * handler `onAccept` de la modale de consentement (choix utilisateur positif).
 * Renvoie true si l'écriture a réussi, false sinon (storage indispo).
 */
export function giveConsent(): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    const record: ConsentRecord = { consented: true, date: new Date().toISOString() };
    store.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/**
 * Révoque le consentement (droit de retrait). On SUPPRIME simplement la clé :
 * l'état par défaut (absence de clé) EST « non consenti », ce qui garde le
 * storage propre. Après appel, `hasConsented()` renvoie false et l'UI doit
 * re-désactiver toute couche sensible active.
 * Renvoie true si l'opération a abouti (ou s'il n'y avait rien à supprimer).
 */
export function revokeConsent(): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  try {
    store.removeItem(CONSENT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
