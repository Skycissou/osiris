// ─────────────────────────────────────────────────────────────────────────────
//  apiKeys.ts — Registre & stockage des CLÉS API utilisateur (OSIRIS V4 · cockpit)
//  Agent MODULE CLÉS API
//
//  RÔLE
//  ────
//  Permet à l'enquêteur de fournir SES PROPRES clés API directement dans l'app
//  (pas de redéploiement, pas de fichier .env à toucher). Chaque clé est :
//    1. saisie dans le panneau <KeysPanel>,
//    2. stockée LOCALEMENT dans le navigateur (localStorage), clé par service,
//    3. renvoyée en EN-TÊTE HTTP aux routes internes du cockpit (osintClient /
//       liveData), qui la relaient à la source (Shodan, HIBP, NASA FIRMS…).
//
//  ⚠️  MODÈLE DE SÉCURITÉ (à lire) ─────────────────────────────────────────────
//  • Les clés vivent CÔTÉ CLIENT (localStorage du navigateur de l'enquêteur).
//    Elles NE sont PAS chiffrées : localStorage est en clair. C'est un choix
//    assumé « usage perso / poste de confiance », pas un coffre-fort partagé.
//  • Elles ne transitent QUE vers NOS routes serveur Next (même origine), via
//    l'en-tête `x-osiris-key-<service>`. Jamais envoyées à un tiers directement
//    depuis le navigateur : c'est le serveur qui appelle la source finale.
//  • Effaçables à tout moment (bouton « Effacer » du panneau, ou clearKey).
//  Destiné à l'usage personnel d'un enquêteur ARPD sur son propre poste.
//
//  CONVENTION PARTAGÉE (d'autres agents s'y alignent — NE PAS diverger) :
//    • localStorage : clé  `osiris-apikey-<service>`
//    • en-tête HTTP :       `x-osiris-key-<service>`   (service en minuscule)
//  Le côté serveur relit l'en-tête et, à défaut, retombe sur la variable
//  d'environnement correspondante (colonne `env` ci-dessous).
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

// ── Catalogue des services ───────────────────────────────────────────────────
/**
 * Identifiant d'un service = suffixe de la clé localStorage et de l'en-tête.
 * Toujours en minuscule (les en-têtes HTTP sont insensibles à la casse mais on
 * fige la forme minuscule pour éviter toute divergence entre agents).
 */
export type ApiKeyService =
  | 'shodan' // Shodan — exposition réseau (osint)
  | 'hibp' // HaveIBeenPwned — fuites d'e-mails (osint/leaks)
  | 'abuseipdb' // AbuseIPDB — réputation d'IP (osint/threats)
  | 'firms' // NASA FIRMS — feux actifs (couche carto)
  | 'github' // GitHub — quota API (osint/github)
  | 'opensanctions' // OpenSanctions — quota listes de sanctions
  | 'ais_url' // Source AIS REST — gabarit d'URL (navires)
  | 'ais_key' // Source AIS REST — clé (navires)
  | 'cctv' // Caméras publiques — source OSINT (forme 2)
  | 'gpsjam' // Brouillage GPS — source OSINT (forme 2)
  | 'scanner' // Scanners radio — agrégateur (forme 2)
  | 'sigint' // Mesh / APRS — source OSINT (forme 2)
  | 'telegram'; // Flux Telegram — bot / API (forme 2)

/**
 * Métadonnées d'un service pour l'UI (panneau documenté) et le serveur.
 *  - `service` : identifiant (suffixe localStorage + en-tête).
 *  - `label`   : nom lisible FR affiché dans le panneau.
 *  - `env`     : variable d'environnement serveur de repli (doc / handoff infra).
 *  - `purpose` : à quoi ça sert, en une phrase FR.
 *  - `url`     : lien direct pour obtenir la clé.
 *  - `howTo`   : procédure courte FR (1-2 phrases) pour récupérer la clé.
 *  - `cost`    : indication de coût (gratuit / payant / variable).
 *  - `form`    : forme d'intégration OSIRIS — 1 = outil OSINT / couche standard,
 *               2 = source « sensible » (câblage variable selon le fournisseur).
 *               Optionnel : absent = forme 1 par défaut.
 */
export interface ApiKeyServiceMeta {
  service: ApiKeyService;
  label: string;
  env: string;
  purpose: string;
  url: string;
  howTo: string;
  cost: string;
  /** 1 = standard (OSINT/couche) · 2 = source sensible à câblage variable. */
  form?: 1 | 2;
}

/**
 * Registre canonique des services (données du tableau de spécification).
 * L'ordre reflète les familles : OSINT d'abord, puis couches carto, puis
 * sources « sensibles » (forme 2). Le panneau les regroupe par catégorie.
 */
export const API_KEY_SERVICES: readonly ApiKeyServiceMeta[] = [
  // ── OSINT (boîte à outils) ────────────────────────────────────────────────
  // (⏸️ Service 'llm' / briefing IA retiré le 05/07 à la demande de Cissou —
  //  la route /analyze et son client restent dormants dans le repo.)
  {
    service: 'shodan',
    label: 'Shodan',
    env: 'SHODAN_KEY',
    purpose: 'Exposition réseau : ports ouverts et services d’une IP (OSINT).',
    url: 'https://account.shodan.io',
    howTo:
      'Crée un compte Shodan, ouvre la page « Account », copie ta clé « API Key ».',
    cost: 'payant',
    form: 1,
  },
  {
    service: 'hibp',
    label: 'HaveIBeenPwned (fuites)',
    env: 'HIBP_KEY',
    purpose: 'Fuites de données connues associées à un e-mail (OSINT / leaks).',
    url: 'https://haveibeenpwned.com/API/Key',
    howTo:
      'Souscris une clé API HIBP (abonnement mensuel), puis copie la clé fournie.',
    cost: 'payant (~3,95 $/mois)',
    form: 1,
  },
  {
    service: 'abuseipdb',
    label: 'AbuseIPDB (réputation IP)',
    env: 'ABUSEIPDB_KEY',
    purpose: 'Réputation et signalements de menace d’une IP (OSINT / threats).',
    url: 'https://www.abuseipdb.com/account/api',
    howTo:
      'Crée un compte AbuseIPDB, va dans « Account → API », génère puis copie une clé.',
    cost: 'gratuit (quota)',
    form: 1,
  },
  {
    service: 'github',
    label: 'GitHub (quota API)',
    env: 'GITHUB_TOKEN',
    purpose: 'Augmente le quota des requêtes profil/dépôts GitHub (OSINT).',
    url: 'https://github.com/settings/tokens',
    howTo:
      'Réglages GitHub → Developer settings → Tokens (classic) → génère un token à droits publics.',
    cost: 'gratuit',
    form: 1,
  },
  {
    service: 'opensanctions',
    label: 'OpenSanctions (quota)',
    env: 'OPENSANCTIONS_KEY',
    purpose: 'Augmente le quota des recherches sur les listes de sanctions.',
    url: 'https://www.opensanctions.org/api/',
    howTo:
      'Crée un compte sur le portail API OpenSanctions, puis récupère ta clé d’API.',
    cost: 'gratuit (palier)',
    form: 1,
  },
  // ── Couches carto ─────────────────────────────────────────────────────────
  {
    service: 'firms',
    label: 'NASA FIRMS (feux)',
    env: 'FIRMS_MAP_KEY',
    purpose: 'Couche « feux actifs » (foyers thermiques NASA FIRMS).',
    url: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
    howTo:
      'Ouvre la page « MAP_KEY » de FIRMS, renseigne ton e-mail, la clé t’est envoyée / affichée.',
    cost: 'gratuit',
    form: 1,
  },
  {
    service: 'ais_url',
    label: 'Source AIS — gabarit URL (⚠️ au déploiement, pas ici)',
    env: 'AIS_REST_URL',
    purpose:
      'URL de la source REST des navires (AIS). Pour raison de sécurité (SSRF), le gabarit d’URL se définit UNIQUEMENT côté serveur via la variable d’environnement AIS_REST_URL, PAS dans l’app. Seule la clé AIS se saisit ici.',
    url: '', // fournisseur AIS variable — pas de lien canonique
    howTo:
      'Ne se renseigne PAS ici : pose AIS_REST_URL dans l’environnement du conteneur au déploiement (gabarit REST de ton fournisseur). La clé AIS, elle, reste saisissable dans l’app.',
    cost: 'variable',
    form: 1,
  },
  {
    service: 'ais_key',
    label: 'Source AIS — clé (navires)',
    env: 'AIS_REST_KEY',
    purpose: 'Clé d’accès de la source REST AIS (positions de navires).',
    url: '', // idem : dépend du fournisseur AIS
    howTo:
      'Récupère la clé auprès de ton fournisseur AIS REST et colle-la ici (même service que le gabarit d’URL).',
    cost: 'variable',
    form: 1,
  },
  // ── Sources sensibles (forme 2 — câblage variable) ────────────────────────
  {
    service: 'cctv',
    label: 'Caméras (CCTV)',
    env: 'CCTV_SOURCE_KEY',
    purpose: 'Accès à une source de caméras publiques (forme 2, variable).',
    url: '', // source OSINT variable
    howTo:
      'Renseigne la clé de la source de caméras OSINT que tu utilises (dépend du fournisseur).',
    cost: 'variable',
    form: 2,
  },
  {
    service: 'gpsjam',
    label: 'Brouillage GPS (GPSJam)',
    env: 'GPSJAM_KEY',
    purpose: 'Données de brouillage / interférence GPS (forme 2).',
    url: 'https://gpsjam.org',
    howTo:
      'Selon la source (GPSJam ou un dérivé ADS-B), récupère la clé/jeton d’accès et colle-la ici.',
    cost: 'variable',
    form: 2,
  },
  {
    service: 'scanner',
    label: 'Scanners radio',
    env: 'SCANNER_KEY',
    purpose: 'Flux de scanners radio via un agrégateur (forme 2).',
    url: '', // agrégateur radio variable
    howTo:
      'Renseigne la clé de l’agrégateur de scanners radio que tu utilises (variable selon le service).',
    cost: 'variable',
    form: 2,
  },
  {
    service: 'sigint',
    label: 'Mesh / APRS (SIGINT passif)',
    env: 'SIGINT_KEY',
    purpose: 'Sources mesh / APRS pour signaux passifs (forme 2).',
    url: '', // source OSINT variable
    howTo:
      'Colle la clé de ta source mesh/APRS (variable selon le réseau/fournisseur).',
    cost: 'variable',
    form: 2,
  },
  {
    service: 'telegram',
    label: 'Flux Telegram',
    env: 'TELEGRAM_OSINT_KEY',
    purpose: 'Récupération de flux Telegram publics (forme 2).',
    url: 'https://core.telegram.org',
    howTo:
      'Crée un bot via @BotFather (ou une app sur my.telegram.org) et colle le token / la clé ici.',
    cost: 'gratuit',
    form: 2,
  },
] as const;

/**
 * Liste figée des identifiants de services (utile pour itérer / valider).
 * Dérivée du registre pour rester en un seul point de vérité.
 */
export const ALL_API_KEY_SERVICES: readonly ApiKeyService[] =
  API_KEY_SERVICES.map((s) => s.service);

/** Accès direct aux métadonnées d'un service (ou undefined si inconnu). */
export function getServiceMeta(service: ApiKeyService): ApiKeyServiceMeta | undefined {
  return API_KEY_SERVICES.find((s) => s.service === service);
}

// ── Stockage localStorage (SSR-safe, jamais de throw) ─────────────────────────
/** Préfixe des clés localStorage (convention partagée entre agents). */
const STORAGE_PREFIX = 'osiris-apikey-';

/** Préfixe des en-têtes HTTP (convention partagée entre agents). */
const HEADER_PREFIX = 'x-osiris-key-';

/** Nom de la clé localStorage pour un service donné. */
function storageKey(service: ApiKeyService): string {
  return `${STORAGE_PREFIX}${service}`;
}

/**
 * Garde SSR : localStorage n'existe pas côté serveur (Next SSR) ni si l'accès
 * est bloqué (mode privé strict). On teste la présence de l'objet à chaque
 * appel — jamais de throw, on retombe sur un comportement neutre.
 */
function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    // Accès localStorage refusé (navigation privée / politique) → neutre.
    return null;
  }
}

/**
 * Lit la clé d'un service. Renvoie '' si absente, si SSR, ou en cas d'erreur.
 * Ne throw jamais.
 */
export function getKey(service: ApiKeyService): string {
  const store = safeStorage();
  if (!store) return '';
  try {
    return store.getItem(storageKey(service)) ?? '';
  } catch {
    return '';
  }
}

/**
 * Enregistre (ou remplace) la clé d'un service. Une valeur vide / blanche
 * revient à effacer la clé (évite de stocker du vide). Renvoie true si l'opé
 * a pu être tentée (localStorage dispo), false sinon. Ne throw jamais.
 */
export function setKey(service: ApiKeyService, value: string): boolean {
  const store = safeStorage();
  if (!store) return false;
  const v = (value ?? '').trim();
  try {
    if (!v) {
      store.removeItem(storageKey(service));
    } else {
      store.setItem(storageKey(service), v);
    }
    return true;
  } catch {
    // Quota plein / stockage indisponible → échec silencieux.
    return false;
  }
}

/** Efface la clé d'un service. Ne throw jamais. Renvoie true si tenté. */
export function clearKey(service: ApiKeyService): boolean {
  const store = safeStorage();
  if (!store) return false;
  try {
    store.removeItem(storageKey(service));
    return true;
  } catch {
    return false;
  }
}

/** true si une clé NON VIDE est stockée pour ce service. Ne throw jamais. */
export function hasKey(service: ApiKeyService): boolean {
  return getKey(service).length > 0;
}

// ── Construction des en-têtes pour les appels réseau ──────────────────────────
/**
 * keyHeaders — construit l'objet d'en-têtes `x-osiris-key-<service>` pour les
 * services demandés QUI ONT une clé stockée. Les services sans clé sont omis
 * (le serveur retombera sur sa variable d'environnement de repli).
 *
 * Destiné à être fusionné dans les `headers` d'un `fetch` par osintClient /
 * liveData, p.ex. :
 *
 *   const headers = { Accept: 'application/json', ...keyHeaders(['shodan']) };
 *
 * @param services liste des services dont on veut joindre la clé si présente.
 * @returns dictionnaire { 'x-osiris-key-shodan': '…', … } (vide si aucune clé).
 */
export function keyHeaders(services: ApiKeyService[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const service of services) {
    const value = getKey(service);
    if (value) {
      headers[`${HEADER_PREFIX}${service}`] = value;
    }
  }
  return headers;
}

/**
 * Variante « toutes les clés configurées » : construit les en-têtes pour TOUS
 * les services qui ont une clé. Pratique pour un client générique qui ne sait
 * pas à l'avance quels services une route consomme.
 */
export function allKeyHeaders(): Record<string, string> {
  return keyHeaders([...ALL_API_KEY_SERVICES]);
}
