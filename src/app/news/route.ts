// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — NEWS : fil d'actualité géopolitique (agrégation d'actus publiques).
//
//  RÔLE : renvoyer les derniers articles de presse publiés (24 h) autour d'un
//  thème géopolitique / sécurité, via l'API DOC de GDELT 2.0. GDELT indexe en
//  continu les médias du monde entier ; l'API est GRATUITE et NE requiert AUCUNE
//  clé. On n'interroge JAMAIS une cible fournie par l'utilisateur : le thème
//  n'est qu'un paramètre de recherche envoyé au fournisseur fixe (api.gdeltproject.org).
//
//  SOURCE PUBLIQUE GRATUITE (sans clé) :
//    https://api.gdeltproject.org/api/v2/doc/doc
//      ?query=<REQUÊTE>          requête plein-texte (+ opérateur sourcelang:)
//      &mode=ArtList             liste d'articles
//      &format=json              sortie JSON
//      &maxrecords=40            plafond d'articles
//      &timespan=24h             fenêtre glissante 24 h
//      &sort=DateDesc            les plus récents d'abord
//
//  CONTRAT (client) :
//    GET /news?q=<thème?>&lang=<fr|en?>
//      • q    (optionnel) thème de recherche ; défaut = requête géopolitique/sécurité
//      • lang (optionnel) 'fr' → filtre sourcelang:french · 'en' → sourcelang:english
//    → 200 { articles: [{ title, url, domain?, seendate?, sourcecountry?, language?, socialimage? }] }
//    → 200 { articles: [], error?: 'message FR' }   (dégradation douce, JAMAIS de 500)
//
//  CADRE DÉFENSIF ARPD : simple AGRÉGATION d'actualités PUBLIQUES déjà diffusées
//  par les médias, à des fins de veille géopolitique légale. Aucune donnée privée,
//  aucun ciblage de personne, aucune collecte au-delà des métadonnées d'articles
//  publiés que GDELT expose déjà librement.
//
//  Ré-écriture clean-room (calque : src/app/osint/sanctions/route.ts,
//  src/app/osint/whois/route.ts) : aucune ligne copiée d'un autre projet.
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

// Toujours dynamique : fil d'actu à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

/** Timeout réseau vers l'API GDELT (ms). */
const FETCH_TIMEOUT_MS = 9_000;
/** Longueur max acceptée pour le thème (garde-fou anti-abus). */
const MAX_Q_LEN = 200;
/** Plafond d'articles demandés à GDELT et renvoyés au client. */
const MAX_RECORDS = 40;
/** User-Agent identifiant l'appelant (étiquette). */
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

/**
 * Requête géopolitique par défaut si l'utilisateur ne précise pas de thème.
 * Formulée en anglais (langue pivot de l'indexation GDELT) et volontairement
 * large : conflits, sécurité, diplomatie, sanctions, cyber. Les parenthèses +
 * OR sont la syntaxe attendue par le moteur DOC de GDELT.
 */
const DEFAULT_QUERY =
  '(geopolitics OR conflict OR "national security" OR diplomacy OR sanctions OR military OR cyberattack)';

/** Un article normalisé renvoyé au client (champs optionnels tolérés). */
interface NewsArticle {
  title: string;
  url: string;
  domain?: string;
  seendate?: string;
  sourcecountry?: string;
  language?: string;
  socialimage?: string;
}

/** Réponse normalisée renvoyée au client. */
interface NewsResult {
  articles: NewsArticle[];
  error?: string;
}

/** Réponse 200 { articles: [], error } — dégradation douce, jamais un 500. */
function softError(message: string): NextResponse {
  return NextResponse.json(
    { articles: [], error: message } satisfies NewsResult,
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Nettoie le thème utilisateur : on retire les caractères qui casseraient la
 * syntaxe de requête GDELT (guillemets déséquilibrés, parenthèses, deux-points
 * autres que ceux d'un opérateur) tout en gardant lettres/chiffres/espaces et
 * quelques ponctuations utiles. Renvoie '' si rien d'exploitable → le handler
 * retombera sur la requête par défaut.
 */
function sanitizeTheme(raw: string | null): string {
  if (!raw) return '';
  // On conserve lettres (accents inclus), chiffres, espaces, tirets et
  // apostrophes ; tout le reste (parenthèses, guillemets, deux-points…) est
  // remplacé par une espace pour ne pas perturber l'analyseur GDELT.
  const cleaned = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, MAX_Q_LEN);
}

/**
 * Construit la requête GDELT finale à partir du thème (déjà nettoyé) et de la
 * langue. Un thème multi-mots est passé entre guillemets pour rester une
 * expression cohérente ; le filtre langue est ajouté via l'opérateur
 * `sourcelang:` reconnu par GDELT.
 */
function buildQuery(theme: string, lang: 'fr' | 'en' | null): string {
  const base = theme ? (theme.includes(' ') ? `"${theme}"` : theme) : DEFAULT_QUERY;
  if (lang === 'fr') return `${base} sourcelang:french`;
  if (lang === 'en') return `${base} sourcelang:english`;
  return base;
}

/** Lit un champ string non vide d'un objet JSON, sinon undefined. */
function optStr(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const theme = sanitizeTheme(params.get('q'));

  // Langue : 'fr' | 'en' | null (tout autre valeur → pas de filtre).
  const rawLang = (params.get('lang') ?? '').trim().toLowerCase();
  const lang: 'fr' | 'en' | null = rawLang === 'fr' ? 'fr' : rawLang === 'en' ? 'en' : null;

  const query = buildQuery(theme, lang);

  // Fournisseur FIXE : la cible n'est jamais l'utilisateur, seulement api.gdeltproject.org.
  const upstream =
    `https://api.gdeltproject.org/api/v2/doc/doc` +
    `?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&format=json&maxrecords=${MAX_RECORDS}&timespan=24h&sort=DateDesc`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(upstream, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      maxRedirects: 2,
    });
    if (res.status === 429) return softError('quota GDELT atteint, réessaie dans un moment');
    if (!res.ok) return softError(`amont GDELT ${res.status}`);

    // GDELT renvoie parfois du texte (message d'erreur, requête trop large…)
    // avec un content-type JSON : on parse défensivement.
    const text = await res.text();
    let payload: { articles?: unknown };
    try {
      payload = JSON.parse(text) as { articles?: unknown };
    } catch {
      // Corps non-JSON = message GDELT (souvent « requête trop courte/large »).
      const hint = text.trim().slice(0, 140);
      return softError(hint ? `GDELT : ${hint}` : 'réponse GDELT illisible');
    }

    const raw = Array.isArray(payload.articles) ? payload.articles : [];
    const articles: NewsArticle[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const title = optStr(o, 'title');
      const url = optStr(o, 'url');
      // Titre + URL sont indispensables ; sans eux la carte n'a pas de sens.
      if (!title || !url) continue;
      articles.push({
        title,
        url,
        domain: optStr(o, 'domain'),
        seendate: optStr(o, 'seendate'),
        sourcecountry: optStr(o, 'sourcecountry'),
        language: optStr(o, 'language'),
        socialimage: optStr(o, 'socialimage'),
      });
      if (articles.length >= MAX_RECORDS) break;
    }

    return NextResponse.json(
      { articles } satisfies NewsResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout GDELT' : 'échec réseau GDELT');
  } finally {
    clearTimeout(timeout);
  }
}
