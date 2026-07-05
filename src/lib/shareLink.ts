// ─────────────────────────────────────────────────────────────────────────────
//  shareLink.ts — Lien de partage de la vue carte · OSIRIS V4
//  Agent CONFORT UI
//
//  RÔLE
//  ────
//  Construit une URL partageable qui encode l'état courant de la carte (couches
//  actives, recherche éventuelle, centre + zoom) dans la querystring, et sait la
//  copier dans le presse-papiers. Un collègue qui ouvre le lien retrouve la même
//  vue (la page relit `?layers=` / `?q=` au chargement — cf. page.tsx).
//
//  CONVENTION QUERYSTRING (alignée sur la page)
//  ────────────────────────────────────────────
//    layers = clés de couches actives, séparées par des virgules
//    q      = dernière recherche (facultatif)
//    lat / lng / zoom = centre + zoom de la carte (facultatifs)
//  On repart TOUJOURS de l'origine + pathname RÉELS de la page (donc le basePath
//  /cockpit est préservé) — jamais d'URL en dur.
//
//  SSR : `window` est absent au rendu serveur. `buildShareUrl` renvoie alors ''
//  (chaîne vide) plutôt que de throw ; l'appelant traite '' comme « pas de lien
//  disponible ». `copyShareUrl` ne throw jamais non plus.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

/** Paramètres encodables dans le lien de partage. Tous facultatifs. */
export interface ShareParams {
  /** Clés des couches actives (ex. ['live_aircraft', 'fr_ban']). */
  layers?: string[];
  /** Dernière recherche saisie (continuité de contexte). */
  q?: string;
  /** Latitude du centre carte. */
  lat?: number;
  /** Longitude du centre carte. */
  lng?: number;
  /** Niveau de zoom MapLibre. */
  zoom?: number;
}

/**
 * buildShareUrl — assemble l'URL partageable à partir de l'origine + pathname
 * courants et des paramètres fournis. Les champs vides / absents sont omis pour
 * garder un lien propre.
 *
 * @param params état de carte à encoder (tout est optionnel).
 * @returns URL absolue (ex. `https://…/cockpit?layers=…&q=…`), ou '' si appelé
 *          côté serveur (pas de `window`). Ne throw jamais.
 */
export function buildShareUrl(params: ShareParams): string {
  if (typeof window === 'undefined') return '';
  try {
    const { origin, pathname } = window.location;
    const qs = new URLSearchParams();

    // Couches : on ne garde que des clés non vides, jointes par des virgules.
    if (params.layers && params.layers.length > 0) {
      const clean = params.layers.filter((k) => typeof k === 'string' && k.length > 0);
      if (clean.length > 0) qs.set('layers', clean.join(','));
    }

    // Recherche : ajoutée seulement si non vide (après trim).
    if (typeof params.q === 'string' && params.q.trim().length > 0) {
      qs.set('q', params.q.trim());
    }

    // Centre + zoom : ajoutés seulement si des nombres finis sont fournis.
    if (typeof params.lat === 'number' && Number.isFinite(params.lat)) {
      qs.set('lat', String(params.lat));
    }
    if (typeof params.lng === 'number' && Number.isFinite(params.lng)) {
      qs.set('lng', String(params.lng));
    }
    if (typeof params.zoom === 'number' && Number.isFinite(params.zoom)) {
      qs.set('zoom', String(params.zoom));
    }

    const query = qs.toString();
    return query ? `${origin}${pathname}?${query}` : `${origin}${pathname}`;
  } catch {
    // Contexte inattendu (location illisible) → pas de lien plutôt qu'une erreur.
    return '';
  }
}

/**
 * copyShareUrl — copie une URL dans le presse-papiers. Tente d'abord l'API
 * moderne `navigator.clipboard.writeText` (nécessite un contexte sécurisé), et
 * retombe sur l'ancienne technique `document.execCommand('copy')` via un
 * <textarea> temporaire si besoin.
 *
 * @param url l'URL à copier (typiquement le retour de buildShareUrl).
 * @returns true si la copie a réussi, false sinon. Ne throw jamais.
 */
export async function copyShareUrl(url: string): Promise<boolean> {
  if (!url || typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  // Voie moderne : Clipboard API (contexte HTTPS / localhost requis).
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // Permission refusée ou contexte non sécurisé → on tente le repli ci-dessous.
  }

  // Voie de repli : <textarea> hors écran + execCommand('copy').
  try {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
