// ─────────────────────────────────────────────────────────────────────────────
//  regionDossier.ts — Dossier de zone au clic droit (OSIRIS V4 · cockpit)
//  Agent C · V4.003
//
//  RÔLE
//  ────
//  Hook React `useRegionDossier()` : à partir de coordonnées {lat,lng} (issues
//  d'un clic droit sur la carte), constitue un « dossier de zone » synthétique en
//  interrogeant EN PARALLÈLE trois sources publiques et gratuites. Le résultat
//  alimente le composant <RegionDossierPanel>.
//
//  CONTRAT
//  ───────
//  useRegionDossier() → {
//    dossier : RegionDossier | null   // dernier dossier constitué (ou null)
//    loading : boolean                // true pendant la collecte
//    error   : string | null          // message FR si TOUT a échoué
//    open(coords)                     // lance la collecte pour ces coordonnées
//    close()                          // ferme / réinitialise le dossier
//  }
//
//  SOURCES (toutes PUBLIQUES — usage DÉFENSIF / ARPD, aucune donnée personnelle
//  ciblée : uniquement du géocodage inverse administratif + des fiches pays
//  ouvertes + les dirigeants officiels d'un État tirés de Wikidata) :
//
//    1. Nominatim (OpenStreetMap) — géocodage inverse
//       → commune / région / pays + code ISO 3166-1 alpha-2 du pays.
//       C'est la source « pivot » : son code pays alimente les deux autres.
//
//    2. restcountries.com — fiche pays ouverte
//       → nom FR, capitale, population, superficie, monnaie, drapeau (emoji).
//
//    3. Wikidata (SPARQL) — dirigeants de l'État
//       → chef d'État (P35) et chef du gouvernement (P122), libellés FR.
//       Le pays est retrouvé par son code ISO alpha-2 (propriété P297), ce qui
//       ÉVITE toute table de correspondance ISO→QID à maintenir (cf. NOTE plus bas).
//
//  DÉGRADATION DOUCE : chaque source est indépendante et tolérante à l'échec
//  (Promise.allSettled + timeout par appel). Si une source tombe, son champ est
//  simplement absent et le dossier s'affiche quand même avec ce qui a été obtenu.
//  `error` n'est renseigné que si la source pivot (Nominatim) échoue et qu'aucune
//  donnée exploitable n'a pu être réunie.
//
//  EXEMPLE D'INTÉGRATION (dans src/app/page.tsx) :
//    const { dossier, loading, error, open, close } = useRegionDossier();
//    const handleRightClick = useCallback((c) => open(c), [open]);
//    // ... dans le JSX :
//    {(dossier || loading) && (
//      <RegionDossierPanel dossier={dossier} loading={loading} error={error} onClose={close} />
//    )}
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { useCallback, useRef, useState } from 'react';

// ── Types exportés ───────────────────────────────────────────────────────────

/** Coordonnées géographiques (degrés décimaux, WGS84). */
export interface RegionCoords {
  lat: number;
  lng: number;
}

/**
 * Dossier de zone constitué à partir d'un point de la carte.
 * Tous les champs (hors `coords` et `sources`) sont OPTIONNELS : ils ne sont
 * présents que si la source correspondante a répondu (dégradation douce).
 */
export interface RegionDossier {
  /** Point interrogé (clic droit). */
  coords: RegionCoords;
  // ── Localisation (Nominatim) ──
  commune?: string;
  region?: string;
  pays?: string;
  /** Code ISO 3166-1 alpha-2 du pays (ex. « FR »). Interne aux appels 2 et 3. */
  paysCode?: string;
  // ── Fiche pays (restcountries) ──
  capitale?: string;
  population?: number;
  /** Superficie en km². */
  superficie?: number;
  monnaie?: string;
  /** Drapeau : emoji (ex. « 🇫🇷 ») ou URL d'image en repli. */
  drapeau?: string;
  // ── Gouvernance (Wikidata) ──
  chefEtat?: string;
  chefGouvernement?: string;
  /** Liste des sources ayant effectivement contribué (pour le badge de crédit). */
  sources: string[];
}

/** Valeur de retour du hook. */
export interface UseRegionDossier {
  dossier: RegionDossier | null;
  loading: boolean;
  error: string | null;
  open: (coords: RegionCoords) => void;
  close: () => void;
}

// ── Constantes ───────────────────────────────────────────────────────────────

/** Délai maximal par appel réseau (ms). Au-delà → source considérée en échec. */
const TIMEOUT_MS = 8000;

/**
 * En-tête d'identification poli, recommandé par Nominatim et Wikidata pour tout
 * usage automatisé. (Note : les navigateurs interdisent la surcharge du header
 * `User-Agent` en fetch — on passe donc l'identité via `Referer`/`Accept`, mais
 * on conserve la constante documentée pour tout portage serveur éventuel.)
 */
const APP_UA = 'OSIRIS-Cockpit/4.0 (usage defensif ARPD; contact cissouhub.cloud)';

// ── Utilitaire : fetch avec timeout (AbortController) ─────────────────────────

/**
 * `fetch` enrobé d'un timeout dur. Rejette si la réponse dépasse `TIMEOUT_MS`
 * ou si le statut HTTP n'est pas OK — ce qui laisse Promise.allSettled marquer
 * proprement la source en échec sans faire tomber les autres.
 */
async function fetchTimeout(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Source 1 : Nominatim (géocodage inverse) ─────────────────────────────────

interface NominatimResult {
  commune?: string;
  region?: string;
  pays?: string;
  paysCode?: string;
}

/**
 * Géocodage inverse OSM : traduit un point en découpage administratif FR
 * (commune / région / pays) + code ISO alpha-2 du pays. `zoom=10` cible le
 * niveau « ville », `accept-language=fr` force les libellés français.
 */
async function fetchNominatim({ lat, lng }: RegionCoords): Promise<NominatimResult> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}` +
    `&format=json&zoom=10&addressdetails=1&accept-language=fr`;
  const res = await fetchTimeout(url, { 'Accept-Language': 'fr' });
  const data = await res.json();
  const a = data.address || {};
  return {
    commune: a.city || a.town || a.village || a.municipality || a.county || undefined,
    region: a.state || a.region || a.state_district || undefined,
    pays: a.country || undefined,
    // country_code est en minuscules (« fr ») → normalisé en majuscules.
    paysCode: a.country_code ? String(a.country_code).toUpperCase() : undefined,
  };
}

// ── Source 2 : restcountries (fiche pays) ────────────────────────────────────

interface CountryResult {
  pays?: string;
  capitale?: string;
  population?: number;
  superficie?: number;
  monnaie?: string;
  drapeau?: string;
}

/**
 * Fiche pays ouverte. On demande uniquement les champs utiles (`fields=`) pour
 * alléger la réponse. `translations.fra.common` donne le nom FR ; `flag` est un
 * emoji (repli sur `flags.png` si absent). L'endpoint renvoie un tableau → [0].
 */
async function fetchCountry(code: string): Promise<CountryResult> {
  const url =
    `https://restcountries.com/v3.1/alpha/${encodeURIComponent(code)}` +
    `?fields=name,translations,capital,population,area,currencies,flag,flags`;
  const res = await fetchTimeout(url);
  const json = await res.json();
  const c = Array.isArray(json) ? json[0] : json;
  if (!c) throw new Error('pays introuvable');

  // Monnaie : premier code de l'objet currencies → « Euro (€) ».
  let monnaie: string | undefined;
  if (c.currencies && typeof c.currencies === 'object') {
    const first = Object.values(c.currencies)[0] as { name?: string; symbol?: string } | undefined;
    if (first?.name) monnaie = first.symbol ? `${first.name} (${first.symbol})` : first.name;
  }

  return {
    pays: c.translations?.fra?.common || c.name?.common || undefined,
    capitale: Array.isArray(c.capital) ? c.capital[0] : c.capital || undefined,
    population: typeof c.population === 'number' ? c.population : undefined,
    superficie: typeof c.area === 'number' ? c.area : undefined,
    monnaie,
    drapeau: c.flag || c.flags?.png || c.flags?.svg || undefined,
  };
}

// ── Source 3 : Wikidata SPARQL (dirigeants) ──────────────────────────────────

interface GovResult {
  chefEtat?: string;
  chefGouvernement?: string;
}

/**
 * Chef d'État (P35) et chef du gouvernement (P122) du pays, libellés FR.
 *
 * NOTE ROBUSTESSE — pourquoi P297 et pas une table ISO→QID :
 * On retrouve l'entité pays par sa propriété « code ISO 3166-1 alpha-2 » (P297)
 * directement dans la requête SPARQL. Aucun dictionnaire QID à maintenir côté
 * code : le code pays fourni par Nominatim suffit, et Wikidata reste la source
 * de vérité. `SERVICE wikibase:label` fournit les libellés en français.
 */
async function fetchGovernance(code: string): Promise<GovResult> {
  const sparql = `
    SELECT ?chefEtatLabel ?chefGouvLabel WHERE {
      ?pays wdt:P297 "${code.toUpperCase()}" .
      OPTIONAL { ?pays wdt:P35 ?chefEtat. }
      OPTIONAL { ?pays wdt:P122 ?chefGouv. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    } LIMIT 1`;
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const res = await fetchTimeout(url, { Accept: 'application/sparql-results+json' });
  const json = await res.json();
  const b = json?.results?.bindings?.[0];
  if (!b) throw new Error('gouvernance introuvable');
  return {
    chefEtat: b.chefEtatLabel?.value || undefined,
    chefGouvernement: b.chefGouvLabel?.value || undefined,
  };
}

// ── Hook principal ───────────────────────────────────────────────────────────

/**
 * Orchestrateur : lance Nominatim d'abord (source pivot, fournit le code pays),
 * puis restcountries + Wikidata EN PARALLÈLE sur ce code. `Promise.allSettled`
 * garantit qu'une source défaillante n'empêche pas l'affichage des autres.
 *
 * Un compteur de requête (`reqId`) protège des courses : si l'utilisateur clique
 * droit ailleurs pendant une collecte, seule la dernière requête écrit l'état.
 */
export function useRegionDossier(): UseRegionDossier {
  const [dossier, setDossier] = useState<RegionDossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const open = useCallback(async (coords: RegionCoords) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    setDossier(null);

    // Étape 1 — Nominatim (pivot). Son échec n'est PAS bloquant, mais sans code
    // pays on ne peut pas enrichir : on tente quand même les 2 autres à vide.
    const nomRes = await Promise.allSettled([fetchNominatim(coords)]);
    if (id !== reqId.current) return; // requête périmée → on abandonne
    const nom = nomRes[0].status === 'fulfilled' ? nomRes[0].value : null;
    const code = nom?.paysCode;

    // Étape 2 — restcountries + Wikidata en parallèle, seulement si code connu.
    const [countryRes, govRes] = code
      ? await Promise.allSettled([fetchCountry(code), fetchGovernance(code)])
      : [
          { status: 'rejected' } as PromiseRejectedResult,
          { status: 'rejected' } as PromiseRejectedResult,
        ];
    if (id !== reqId.current) return;

    const country = countryRes.status === 'fulfilled' ? countryRes.value : null;
    const gov = govRes.status === 'fulfilled' ? govRes.value : null;

    // Crédit des sources ayant réellement contribué.
    const sources: string[] = [];
    if (nom) sources.push('Nominatim (OSM)');
    if (country) sources.push('restcountries');
    if (gov) sources.push('Wikidata');

    // Aucune source exploitable → on remonte une erreur FR lisible.
    if (!nom && !country && !gov) {
      setError('Impossible de constituer le dossier (sources indisponibles).');
      setLoading(false);
      return;
    }

    setDossier({
      coords,
      commune: nom?.commune,
      region: nom?.region,
      // Nom pays FR : privilégie restcountries (traduction) sinon Nominatim.
      pays: country?.pays || nom?.pays,
      paysCode: code,
      capitale: country?.capitale,
      population: country?.population,
      superficie: country?.superficie,
      monnaie: country?.monnaie,
      drapeau: country?.drapeau,
      chefEtat: gov?.chefEtat,
      chefGouvernement: gov?.chefGouvernement,
      sources,
    });
    setLoading(false);
  }, []);

  const close = useCallback(() => {
    reqId.current++; // invalide toute collecte en cours
    setDossier(null);
    setLoading(false);
    setError(null);
  }, []);

  return { dossier, loading, error, open, close };
}

// Constante exportée pour tout portage serveur (voir commentaire APP_UA).
export { APP_UA };
