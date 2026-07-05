// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / GITHUB : profil public + top dépôts d'un compte.
//
//  SOURCE : https://api.github.com  — API PUBLIQUE (aucune clé obligatoire).
//    • https://api.github.com/users/{q}
//    • https://api.github.com/users/{q}/repos?per_page=10&sort=updated
//  Sans token : fonctionne mais RATE-LIMITÉ (60 req/h par IP). Si la variable
//  d'env GITHUB_TOKEN est présente, on l'envoie en `Authorization` pour relever
//  la limite (5000 req/h). Le token reste OPTIONNEL : rien ne casse sans lui.
//
//  CONTRAT (client) :
//    GET /osint/github?q=<login>
//    → 200 { login, name?, bio?, company?, location?, created_at?,
//            public_repos?, followers?, topRepos? }
//    → 200 { error: '<message>' }                          (dégradation douce)
//    topRepos : [{ name, stars, language?, description? }] triés par étoiles.
//    Jamais de 500.
//
//  CADRE ARPD : données de PROFIL PUBLIC volontairement publiées par l'utilisateur
//  sur GitHub. Veille défensive, aucune donnée privée, aucun ciblage.
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : GITHUB_TOKEN (OPTIONNELLE — augmente juste le quota).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;
/** Longueur max d'un login GitHub (39 en pratique) + marge de garde. */
const MAX_Q_LEN = 64;
const USER_AGENT = 'Osiris-Cockpit/4.0 (ARPD veille; +https://osiris.cissouhub.cloud)';

function softError(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

/** En-têtes communs aux deux appels ; ajoute Authorization si un token existe. */
function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

interface RawUser {
  login?: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  created_at?: string;
  public_repos?: number;
  followers?: number;
}

interface RawRepo {
  name?: string;
  stargazers_count?: number;
  language?: string | null;
  description?: string | null;
  fork?: boolean;
}

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!q) return softError('paramètre q requis (login GitHub)');
  if (q.length > MAX_Q_LEN) return softError('paramètre q trop long');
  // Un login GitHub valide : alphanumérique + tirets. On refuse tôt tout ce qui
  // sort de ce jeu (protège du path traversal et des sondes).
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(q)) return softError('login GitHub invalide');

  const headers = ghHeaders();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // 1) Profil. C'est l'appel bloquant : sans profil, rien à renvoyer.
    const userRes = await safeFetch(`https://api.github.com/users/${encodeURIComponent(q)}`, {
      method: 'GET',
      signal: controller.signal,
      headers,
      maxRedirects: 2,
    });
    if (userRes.status === 404) return softError('compte GitHub introuvable');
    if (userRes.status === 403) return softError('quota GitHub atteint (ajouter GITHUB_TOKEN)');
    if (!userRes.ok) return softError(`amont GitHub ${userRes.status}`);
    const user = (await userRes.json()) as RawUser;

    // 2) Dépôts. NON bloquant : si l'appel échoue, on renvoie quand même le profil
    //    sans topRepos plutôt que de casser toute la réponse.
    let topRepos: Array<{ name: string; stars: number; language?: string; description?: string }> | undefined;
    try {
      const reposRes = await safeFetch(
        `https://api.github.com/users/${encodeURIComponent(q)}/repos?per_page=10&sort=updated`,
        { method: 'GET', signal: controller.signal, headers, maxRedirects: 2 },
      );
      if (reposRes.ok) {
        const repos = (await reposRes.json()) as RawRepo[];
        if (Array.isArray(repos)) {
          topRepos = repos
            .filter((r) => r && typeof r.name === 'string')
            .map((r) => ({
              name: r.name as string,
              stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
              language: r.language || undefined,
              description: r.description || undefined,
            }))
            .sort((a, b) => b.stars - a.stars)
            .slice(0, 10);
        }
      }
    } catch {
      // dépôts indisponibles → on laisse topRepos undefined (dégradation partielle)
    }

    return NextResponse.json(
      {
        login: user.login || q,
        name: user.name || undefined,
        bio: user.bio || undefined,
        company: user.company || undefined,
        location: user.location || undefined,
        created_at: user.created_at || undefined,
        public_repos: typeof user.public_repos === 'number' ? user.public_repos : undefined,
        followers: typeof user.followers === 'number' ? user.followers : undefined,
        topRepos,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return softError(aborted ? 'timeout GitHub' : 'échec réseau GitHub');
  } finally {
    clearTimeout(timeout);
  }
}
