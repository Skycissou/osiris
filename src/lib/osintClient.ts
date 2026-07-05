// ─────────────────────────────────────────────────────────────────────────────
//  osintClient.ts — Client typé de la BOÎTE À OUTILS OSINT (OSIRIS V4 · cockpit)
//  Agent PANNEAU OSINT
//
//  RÔLE
//  ────
//  Fournit au panneau UI (<OsintPanel>) deux briques pures, sans dépendance :
//    1. detectTargetType(q) : devine le TYPE de cible saisie (IP, domaine,
//       email, CVE, ASN, MAC, téléphone, pseudo…) et propose la liste des
//       OUTILS pertinents à lancer — pas de réseau, 100 % local.
//    2. runLookup(tool, q)  : interroge la route Next interne /osint/{tool},
//       avec timeout + dégradation douce (jamais de throw non-géré côté appelant).
//
//  CADRE DÉFENSIF ARPD : toutes les routes visées n'exploitent QUE des données
//  PUBLIQUES (RDAP, BGP, DNS, transparence des certificats, référentiels de
//  sanctions, bases de fuites déjà divulguées…). Aucune donnée n'est produite
//  ou exfiltrée : on lit ce que les registres et sources publient déjà. Usage
//  strictement veille / enquête légale.
//
//  BASE PATH (cohérence liveData.ts) : le cockpit tourne éventuellement sous un
//  préfixe (ex. /cockpit). Les routes /osint/* sont INTERNES à Next → elles
//  DOIVENT être préfixées par process.env.NEXT_PUBLIC_BASE_PATH, exactement
//  comme les appels /live-feed/* de liveData.ts.
//
//  CONTRAT RÉSEAU (aligné sur les routes existantes whois/bgp) :
//    GET ${basePath}/osint/{tool}?q=<cible>
//    → 200 { …données… }            (résultat exploitable)
//    → 200 { error: 'message FR' }  (dégradation douce, jamais de 500)
//  runLookup normalise tout ça en { tool, ok, data?, error? }.
//
//  Ré-écriture clean-room : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────────

// ── Catalogue des outils ─────────────────────────────────────────────────────
/**
 * Identifiant d'un outil OSINT = segment de route (`/osint/{tool}`).
 * L'ordre reflète grossièrement les familles : réseau, sécurité, identité.
 */
export type OsintTool =
  | 'whois' // enregistrement domaine/IP (RDAP)
  | 'dns' // enregistrements DNS (A, AAAA, MX, TXT, NS…)
  | 'ip' // géolocalisation / ASN / organisation d'une IP
  | 'cve' // fiche vulnérabilité (CVE-AAAA-NNNN)
  | 'mac' // fabricant à partir d'une adresse MAC (OUI)
  | 'certs' // transparence des certificats → sous-domaines
  | 'bgp' // routage : préfixes, ASN, RIR
  | 'github' // profil / présence GitHub d'un pseudo
  | 'sanctions' // listes de sanctions / PPE (données publiques)
  | 'phone' // métadonnées publiques d'un numéro (pays, opérateur)
  | 'shodan' // exposition réseau (ports, services) — clé requise
  | 'leaks' // fuites de données connues pour un email — clé possible
  | 'threats'; // réputation / menace d'une IP/domaine — clé possible

/**
 * Liste complète et figée des outils, dans l'ordre d'affichage « catalogue ».
 * Sert de repli quand la détection ne conclut pas et pour l'UI (chips).
 */
export const ALL_OSINT_TOOLS: readonly OsintTool[] = [
  'whois',
  'dns',
  'ip',
  'bgp',
  'certs',
  'cve',
  'mac',
  'phone',
  'github',
  'sanctions',
  'shodan',
  'leaks',
  'threats',
] as const;

/** Libellé FR court d'un outil (titres de fiches, chips). */
export const OSINT_TOOL_LABELS: Record<OsintTool, string> = {
  whois: 'WHOIS / RDAP',
  dns: 'DNS',
  ip: 'Géo-IP',
  cve: 'CVE',
  mac: 'Adresse MAC',
  certs: 'Certificats',
  bgp: 'BGP / Routage',
  github: 'GitHub',
  sanctions: 'Sanctions',
  phone: 'Téléphone',
  shodan: 'Shodan',
  leaks: 'Fuites',
  threats: 'Menaces',
};

/** Phrase FR décrivant ce que renvoie l'outil (aide/tooltip). */
export const OSINT_TOOL_HINTS: Record<OsintTool, string> = {
  whois: 'Registrar, dates de création/expiration, serveurs de noms.',
  dns: 'Enregistrements A / AAAA / MX / TXT / NS du domaine.',
  ip: 'Pays, ASN, organisation et opérateur de l’adresse IP.',
  cve: 'Description, score CVSS et sévérité de la vulnérabilité.',
  mac: 'Fabricant matériel déduit du préfixe OUI de la MAC.',
  certs: 'Sous-domaines exposés via la transparence des certificats.',
  bgp: 'Préfixes annoncés, ASN et registre régional (RIR).',
  github: 'Profil public, dépôts et activité d’un pseudo.',
  sanctions: 'Présence sur des listes de sanctions / PPE publiques.',
  phone: 'Pays, indicatif et opérateur d’un numéro de téléphone.',
  shodan: 'Ports ouverts et services exposés (clé API requise).',
  leaks: 'Fuites de données connues associées à un e-mail.',
  threats: 'Réputation et signalements de menace d’une IP / domaine.',
};

// ── Type de cible détecté ────────────────────────────────────────────────────
/** Familles de cibles reconnues par detectTargetType. */
export type TargetKind =
  | 'ip' // IPv4 ou IPv6
  | 'domaine' // nom de domaine / FQDN
  | 'email' // adresse e-mail
  | 'mac' // adresse MAC
  | 'cve' // identifiant CVE
  | 'asn' // numéro de système autonome (ASxxxx)
  | 'phone' // numéro de téléphone international (+…)
  | 'pseudo' // pseudo / nom / mot-clé (repli)
  | 'inconnu'; // rien de saisi / non exploitable

/** Résultat de detectTargetType : famille + libellé FR + outils suggérés. */
export interface TargetDetection {
  /** Famille détectée. */
  kind: TargetKind;
  /** Libellé FR affichable de la famille (ex. « adresse IP »). */
  label: string;
  /** Cible normalisée (trim, éventuellement bas-de-casse pour MAC/CVE). */
  normalized: string;
  /** Outils à lancer, dans l'ordre de pertinence. */
  tools: OsintTool[];
}

// ── Expressions régulières de détection ──────────────────────────────────────
//  Volontairement PERMISSIVES mais ancrées (^…$) : la validation stricte /
//  la sécurité (SSRF) sont faites côté route serveur. Ici on ne fait que
//  ORIENTER l'utilisateur vers les bons outils.

/** IPv4 : quatre octets 0-255 séparés par des points. */
const RE_IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/**
 * IPv6 : formes courantes (complète, compressée `::`, IPv4-mapped). Regex
 * pragmatique — couvre les cas usuels sans viser l'exhaustivité RFC.
 */
const RE_IPV6 =
  /^(([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,7}:|([0-9a-f]{1,4}:){1,6}:[0-9a-f]{1,4}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|[0-9a-f]{1,4}:((:[0-9a-f]{1,4}){1,6})|:((:[0-9a-f]{1,4}){1,7}|:))$/i;

/** Adresse e-mail (permissive, ancrée). */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Adresse MAC : 6 octets hex séparés par `:` ou `-`. */
const RE_MAC = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;

/** Identifiant CVE : CVE-AAAA-NNNN(+). */
const RE_CVE = /^cve-\d{4}-\d{4,}$/i;

/** Numéro de système autonome : ASxxxx (préfixe AS obligatoire). */
const RE_ASN = /^as\s?\d{1,10}$/i;

/** Téléphone international : `+` suivi de 6 à 15 chiffres (espaces/points/tirets tolérés). */
const RE_PHONE = /^\+[\d][\d\s.\-()]{5,18}$/;

/**
 * Nom de domaine / FQDN : au moins deux labels, TLD alphabétique de 2+ lettres.
 * On refuse les schémas/chemins ici (l'utilisateur doit saisir un domaine nu) ;
 * detectTargetType tente toutefois d'extraire l'hôte d'une URL collée.
 */
const RE_DOMAIN =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** Libellés FR par famille (pour l'affichage). */
const KIND_LABELS: Record<TargetKind, string> = {
  ip: 'adresse IP',
  domaine: 'nom de domaine',
  email: 'adresse e-mail',
  mac: 'adresse MAC',
  cve: 'vulnérabilité (CVE)',
  asn: 'système autonome (ASN)',
  phone: 'numéro de téléphone',
  pseudo: 'pseudo / mot-clé',
  inconnu: 'cible non reconnue',
};

/**
 * Si l'utilisateur colle une URL (http(s)://host/chemin), on extrait l'hôte nu
 * pour la traiter comme un domaine. Renvoie la chaîne d'origine sinon.
 */
function stripUrl(raw: string): string {
  const m = /^https?:\/\/([^/?#\s]+)/i.exec(raw);
  if (!m) return raw;
  // Retire un éventuel port (:443) et userinfo (user@).
  return m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '');
}

/**
 * detectTargetType — cœur « intelligent » du client.
 * Ordre d'évaluation du plus spécifique au plus générique pour éviter les
 * faux positifs (ex. une CVE ne doit pas matcher « pseudo »).
 *
 * Mapping famille → outils (spéc. agent PANNEAU OSINT) :
 *   IP      → ip, whois, bgp, shodan, threats
 *   domaine → whois, dns, certs, sanctions
 *   email   → leaks, sanctions
 *   MAC     → mac
 *   CVE     → cve
 *   ASN     → bgp
 *   phone   → phone
 *   pseudo  → github, sanctions
 *   repli   → set par défaut raisonnable
 */
export function detectTargetType(q: string): TargetDetection {
  const trimmed = (q ?? '').trim();
  if (!trimmed) {
    return { kind: 'inconnu', label: KIND_LABELS.inconnu, normalized: '', tools: [] };
  }

  // On teste l'hôte extrait d'une éventuelle URL en priorité pour les domaines.
  const host = stripUrl(trimmed);

  // 1) CVE — très spécifique, normalisée en MAJUSCULES.
  if (RE_CVE.test(trimmed)) {
    return { kind: 'cve', label: KIND_LABELS.cve, normalized: trimmed.toUpperCase(), tools: ['cve'] };
  }

  // 2) ASN — préfixe AS obligatoire, normalisé « AS1234 ».
  if (RE_ASN.test(trimmed)) {
    const norm = trimmed.toUpperCase().replace(/\s+/g, '');
    return { kind: 'asn', label: KIND_LABELS.asn, normalized: norm, tools: ['bgp'] };
  }

  // 3) MAC — normalisée en minuscules à séparateurs `:`.
  if (RE_MAC.test(trimmed)) {
    const norm = trimmed.toLowerCase().replace(/-/g, ':');
    return { kind: 'mac', label: KIND_LABELS.mac, normalized: norm, tools: ['mac'] };
  }

  // 4) IP (v4 puis v6).
  if (RE_IPV4.test(trimmed) || RE_IPV6.test(trimmed)) {
    return {
      kind: 'ip',
      label: KIND_LABELS.ip,
      normalized: trimmed,
      tools: ['ip', 'whois', 'bgp', 'shodan', 'threats'],
    };
  }

  // 5) E-mail.
  if (RE_EMAIL.test(trimmed)) {
    return {
      kind: 'email',
      label: KIND_LABELS.email,
      normalized: trimmed.toLowerCase(),
      tools: ['leaks', 'sanctions'],
    };
  }

  // 6) Téléphone international.
  if (RE_PHONE.test(trimmed)) {
    return { kind: 'phone', label: KIND_LABELS.phone, normalized: trimmed, tools: ['phone'] };
  }

  // 7) Domaine (hôte nu ou extrait d'une URL).
  if (RE_DOMAIN.test(host)) {
    return {
      kind: 'domaine',
      label: KIND_LABELS.domaine,
      normalized: host.toLowerCase(),
      tools: ['whois', 'dns', 'certs', 'sanctions'],
    };
  }

  // 8) Repli — pseudo / nom / mot-clé. Set par défaut raisonnable :
  //    identité (github) + vérification listes publiques (sanctions).
  return {
    kind: 'pseudo',
    label: KIND_LABELS.pseudo,
    normalized: trimmed,
    tools: ['github', 'sanctions'],
  };
}

// ── Résultat normalisé d'un lookup ───────────────────────────────────────────
/**
 * Retour uniforme de runLookup. `ok` = requête aboutie ET sans champ `error`
 * dans le corps. `data` porte le JSON brut de la route (forme spécifique à
 * chaque outil — le panneau adapte le rendu). `error` = message FR affichable.
 */
export interface OsintLookupResult {
  tool: OsintTool;
  ok: boolean;
  /** Corps JSON de la route (présent si ok). Forme dépendante de l'outil. */
  data?: Record<string, unknown>;
  /** Message d'erreur FR (dégradation douce) si ok = false. */
  error?: string;
  /**
   * true si l'échec vient d'une CLÉ API manquante côté serveur (shodan, leaks,
   * threats…). Le panneau l'affiche en état « clé requise » (ambre), PAS en
   * erreur rouge alarmante. Déduit du message d'erreur renvoyé par la route.
   */
  authRequired?: boolean;
}

// ── Base path + garde-fous ───────────────────────────────────────────────────
/** Préfixe de route Next (cohérent avec liveData.ts). Défaut ''. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Timeout réseau par défaut d'un lookup (ms). */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Détecte, à partir d'un message d'erreur serveur, s'il s'agit d'une clé API
 * manquante/absente. Heuristique tolérante (FR/EN) — les routes concernées
 * renvoient typiquement « clé requise », « clé manquante », « API key… ».
 */
function isAuthRequiredMessage(msg: string | undefined): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes('clé requise') ||
    m.includes('clé manquante') ||
    m.includes('clé api') ||
    m.includes('clé non configurée') ||
    m.includes('api key') ||
    m.includes('apikey') ||
    (m.includes('token') && m.includes('manqu')) ||
    m.includes('non configuré')
  );
}

/**
 * Construit l'URL interne préfixée par le basePath (jamais d'origine absolue :
 * on reste sur l'origine courante, comme liveData.buildLiveUrl).
 */
function buildOsintUrl(tool: OsintTool, q: string): string {
  const prefix = BASE_PATH.replace(/\/$/, '');
  return `${prefix}/osint/${tool}?q=${encodeURIComponent(q)}`;
}

/**
 * runLookup — interroge une route /osint/{tool}. Ne throw JAMAIS : toute erreur
 * (réseau, timeout, JSON illisible, HTTP ≠ 2xx, corps { error }) est convertie
 * en { ok:false, error }. Idéal pour un Promise.allSettled côté panneau.
 *
 * @param tool   outil à interroger
 * @param q      cible (déjà normalisée de préférence via detectTargetType)
 * @param signal AbortSignal optionnel (ex. démontage du panneau) — combiné au
 *               timeout interne.
 */
// Outil OSINT → service de clé API (les autres outils n'ont pas besoin de clé).
// La clé (si configurée dans le module Clés API) part en en-tête x-osiris-key-*.
import { keyHeaders, type ApiKeyService } from '@/lib/apiKeys';
const OSINT_TOOL_KEY: Partial<Record<OsintTool, ApiKeyService>> = {
  shodan: 'shodan', leaks: 'hibp', threats: 'abuseipdb', github: 'github', sanctions: 'opensanctions',
};

export async function runLookup(
  tool: OsintTool,
  q: string,
  signal?: AbortSignal,
): Promise<OsintLookupResult> {
  const target = (q ?? '').trim();
  if (!target) return { tool, ok: false, error: 'cible vide' };

  const url = buildOsintUrl(tool, target);
  const svc = OSINT_TOOL_KEY[tool];

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
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(svc ? keyHeaders([svc]) : {}) },
      signal: controller.signal,
    });

    // Les routes OSINT visent une dégradation douce en 200 { error }. Un statut
    // ≠ 2xx reste possible (auth cockpit, 404 route absente…) → message clair.
    if (!res.ok) {
      const msg =
        res.status === 401 || res.status === 403
          ? 'accès refusé (session cockpit)'
          : res.status === 404
            ? 'outil indisponible (route absente)'
            : `service indisponible (${res.status})`;
      return { tool, ok: false, error: msg };
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { tool, ok: false, error: 'réponse illisible (JSON invalide)' };
    }

    if (!body || typeof body !== 'object') {
      return { tool, ok: false, error: 'réponse vide' };
    }

    const obj = body as Record<string, unknown>;
    const errMsg = typeof obj.error === 'string' ? obj.error : undefined;
    if (errMsg) {
      const authRequired = isAuthRequiredMessage(errMsg);
      return { tool, ok: false, error: errMsg, authRequired };
    }

    return { tool, ok: true, data: obj };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    return {
      tool,
      ok: false,
      error: aborted ? 'délai dépassé' : 'échec réseau',
    };
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Lance en PARALLÈLE une liste d'outils sur une même cible et renvoie tous les
 * résultats (allSettled interne → jamais de rejet). Le panneau peut aussi
 * appeler runLookup un par un pour un affichage « au fil de l'eau ».
 */
export async function runLookups(
  tools: OsintTool[],
  q: string,
  signal?: AbortSignal,
): Promise<OsintLookupResult[]> {
  const settled = await Promise.allSettled(tools.map((t) => runLookup(t, q, signal)));
  return settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { tool: tools[i], ok: false, error: 'échec inattendu' },
  );
}
