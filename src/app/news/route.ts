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
import { gdeltFetch } from '@/lib/gdeltGate';
import { safeFetch } from '@/lib/ssrf-guard';
import { recordCall } from '@/lib/telemetry';

// Toujours dynamique : fil d'actu à la demande, jamais de pré-rendu / cache statique.
export const dynamic = 'force-dynamic';

// (Timeout/quota/cache GDELT : gérés par le portier partagé lib/gdeltGate.ts.)
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

// ── PLAN B : Google Actualités RSS (ajouté 07/07) ────────────────────────────
//  GDELT rate-limite fort les IP insistantes (pénalités constatées sur le VPS)
//  → quand GDELT échoue (quota/timeout/injoignable), on retombe sur le flux
//  RSS public de Google Actualités : gratuit, sans clé, stable. Mêmes champs
//  NewsArticle → le panneau ne voit pas la différence.

/** Timeout du fallback RSS (Google répond vite ; 7 s pour rester sous le client). */
const RSS_TIMEOUT_MS = 7_000;

/** Décode les entités XML/HTML courantes d'un titre RSS. */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

/** Extrait le contenu d'une balise simple dans un bloc <item>. */
function tag(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : undefined;
}

/**
 * Fil Google Actualités RSS pour un thème + langue. Renvoie null si le flux
 * est injoignable/illisible (l'appelant garde alors l'erreur GDELT d'origine).
 */
async function fetchGoogleNewsRss(theme: string, lang: 'fr' | 'en' | null): Promise<NewsArticle[] | null> {
  const q = theme || 'géopolitique OR cybersécurité OR conflit';
  const locale = lang === 'en'
    ? 'hl=en-US&gl=US&ceid=US:en'
    : 'hl=fr&gl=FR&ceid=FR:fr'; // défaut FR (public OSIRIS)
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${locale}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RSS_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await safeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': USER_AGENT },
      maxRedirects: 3,
    });
    if (!res.ok) {
      // Visible dans /live-feed/diag : savoir si Google RSS répond depuis le VPS.
      recordCall({ source: 'google-rss', ok: false, status: res.status, ms: Date.now() - started });
      return null;
    }
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const articles: NewsArticle[] = [];
    for (const block of items) {
      const title = tag(block, 'title');
      const url2 = tag(block, 'link');
      if (!title || !url2) continue;
      const source = tag(block, 'source');
      articles.push({
        title,
        url: url2,
        ...(source ? { domain: source } : {}),
        ...(tag(block, 'pubDate') ? { seendate: tag(block, 'pubDate') } : {}),
        language: lang === 'en' ? 'English' : 'French',
      });
      if (articles.length >= MAX_RECORDS) break;
    }
    recordCall({ source: 'google-rss', ok: true, status: res.status, ms: Date.now() - started, count: articles.length });
    return articles.length ? articles : null;
  } catch (e) {
    recordCall({ source: 'google-rss', ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** GDELT KO → tente le RSS ; s'il répond, on le sert, sinon l'erreur d'origine. */
async function gdeltDownFallback(theme: string, lang: 'fr' | 'en' | null, originalError: string): Promise<NextResponse> {
  const rss = await fetchGoogleNewsRss(theme, lang);
  if (rss) {
    return NextResponse.json(
      { articles: rss } satisfies NewsResult,
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return softError(originalError);
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

  try {
    // STRATÉGIE (diag 07/07, preuve télémétrie) : GDELT est BLOQUÉ depuis l'IP du
    // VPS (timeout 8 s systématique, `gdelt-doc` toujours en échec) alors que le
    // flux Google Actualités RSS répond en ~0,4 s avec des news FRAÎCHES. On MÈNE
    // donc avec le RSS ; GDELT n'est plus qu'un SECOURS si le RSS ne renvoie rien.
    // → fini l'attente de 8 s et le cache figé de plusieurs heures.
    const rssPrimary = await fetchGoogleNewsRss(theme, lang);
    if (rssPrimary && rssPrimary.length > 0) {
      return NextResponse.json(
        { articles: rssPrimary } satisfies NewsResult,
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    // RSS vide (rare) → on tente GDELT en secours (métadonnées plus riches quand
    // il répond : pays, image). Passe par le portier (quota, cache, stale borné).
    const gate = await gdeltFetch(upstream, USER_AGENT);
    if (!gate) return softError('actualités momentanément indisponibles, réessaie');
    if (!gate.stale && (gate.status === 429 || gate.status < 200 || gate.status >= 300)) {
      return softError('actualités momentanément indisponibles, réessaie');
    }

    // GDELT renvoie parfois du texte (message d'erreur, requête trop large…)
    // avec un content-type JSON : on parse défensivement.
    const text = gate.text;
    let payload: { articles?: unknown };
    try {
      payload = JSON.parse(text) as { articles?: unknown };
    } catch {
      // Corps non-JSON = message GDELT (souvent « requête trop courte/large »).
      const hint = text.trim().slice(0, 140);
      return gdeltDownFallback(theme, lang, hint ? `GDELT : ${hint}` : 'réponse GDELT illisible');
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
  } catch {
    // Le portier gère timeout/quota en interne — ici : erreur inattendue.
    return gdeltDownFallback(theme, lang, 'échec réseau GDELT');
  }
}
