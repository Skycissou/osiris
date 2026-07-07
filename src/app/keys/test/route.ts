// ─────────────────────────────────────────────────────────────────────────────
//  /cockpit/keys/test — TEST DE CONNEXION d'une clé API (serveur only)
//
//  Demande Cissou 07/07 : « quand j'enregistre, ça dit OK mais je vois pas si
//  c'est bien connecté ». Ce endpoint fait un VRAI appel minimal à la source
//  avec la clé fournie et renvoie { ok, status, message } → le bouton
//  « Tester » de la page Clés API affiche ✅ connecté / ❌ + raison.
//
//  La clé vient de l'en-tête x-osiris-key-<service> (envoyé par le client depuis
//  son localStorage) ou, à défaut, de l'env serveur. Jamais renvoyée au client.
//  Tous les appels passent par safeFetch (garde SSRF). Route sous /cockpit,
//  jamais /api/* (Traefik).
//
//  URL : GET /cockpit/keys/test?service=<id>
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { safeFetch } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 12_000;

interface TestResult {
  service: string;
  ok: boolean;
  status?: number;
  message: string;
}

/** Lit une valeur : en-tête client d'abord, sinon variable d'env serveur. */
function val(req: NextRequest, service: string, envName: string): string {
  return (req.headers.get(`x-osiris-key-${service}`) || process.env[envName] || '').trim();
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await safeFetch(url, { method: 'GET', signal: controller.signal, headers, maxRedirects: 2 });
  } finally {
    clearTimeout(timeout);
  }
}

function res(service: string, ok: boolean, message: string, status?: number): NextResponse {
  return NextResponse.json({ service, ok, status, message } satisfies TestResult, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: NextRequest) {
  const service = (req.nextUrl.searchParams.get('service') || '').trim();

  try {
    switch (service) {
      // ── FIRMS (feux) : petite zone → CSV valide si clé bonne ──
      case 'firms': {
        const key = val(req, 'firms', 'FIRMS_MAP_KEY');
        if (!key) return res(service, false, 'Aucune clé fournie');
        const r = await get(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/-5,41,-4,42/1`);
        const text = (await r.text()).slice(0, 200);
        if (/invalid/i.test(text)) return res(service, false, 'Clé FIRMS invalide', r.status);
        const okBody = /country_id|latitude/i.test(text) || text.trim() === '';
        return res(service, r.ok && okBody, r.ok && okBody ? 'Connecté ✅' : `Réponse inattendue: ${text.slice(0, 80)}`, r.status);
      }

      // ── OpenSky : jeton OAuth2 client_credentials (id + secret) ──
      case 'opensky_id':
      case 'opensky_secret': {
        const id = val(req, 'opensky_id', 'OPENSKY_CLIENT_ID');
        const secret = val(req, 'opensky_secret', 'OPENSKY_CLIENT_SECRET');
        if (!id || !secret) return res(service, false, 'Fournis les 2 champs OpenSky (identifiant + secret)');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const r = await safeFetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
            maxRedirects: 2,
          });
          if (r.ok) return res(service, true, 'Connecté ✅ (jeton OpenSky obtenu)', r.status);
          return res(service, false, r.status === 401 ? 'Identifiants OpenSky refusés (401)' : `Erreur OpenSky ${r.status}`, r.status);
        } finally {
          clearTimeout(timeout);
        }
      }

      // ── Shodan : /api-info renvoie le plan si clé valide ──
      case 'shodan': {
        const key = val(req, 'shodan', 'SHODAN_KEY');
        if (!key) return res(service, false, 'Aucune clé fournie');
        const r = await get(`https://api.shodan.io/api-info?key=${encodeURIComponent(key)}`);
        return res(service, r.ok, r.ok ? 'Connecté ✅' : r.status === 401 ? 'Clé Shodan invalide (401)' : `Erreur ${r.status}`, r.status);
      }

      // ── HaveIBeenPwned : en-tête hibp-api-key, 200/404 = clé OK, 401 = KO ──
      case 'hibp': {
        const key = val(req, 'hibp', 'HIBP_KEY');
        if (!key) return res(service, false, 'Aucune clé fournie');
        const r = await get('https://haveibeenpwned.com/api/v3/breachedaccount/test@example.com?truncateResponse=true', {
          'hibp-api-key': key,
          'User-Agent': 'Osiris-Cockpit',
        });
        if (r.status === 401) return res(service, false, 'Clé HIBP invalide (401)', 401);
        if (r.ok || r.status === 404) return res(service, true, 'Connecté ✅', r.status);
        return res(service, false, `Erreur HIBP ${r.status}`, r.status);
      }

      // ── AbuseIPDB : en-tête Key, check d'une IP publique ──
      case 'abuseipdb': {
        const key = val(req, 'abuseipdb', 'ABUSEIPDB_KEY');
        if (!key) return res(service, false, 'Aucune clé fournie');
        const r = await get('https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAgeInDays=1', {
          Key: key,
          Accept: 'application/json',
        });
        return res(service, r.ok, r.ok ? 'Connecté ✅' : r.status === 401 ? 'Clé AbuseIPDB invalide (401)' : `Erreur ${r.status}`, r.status);
      }

      // ── GitHub : /rate_limit avec le token ──
      case 'github': {
        const key = val(req, 'github', 'GITHUB_TOKEN');
        if (!key) return res(service, false, 'Aucun token fourni');
        const r = await get('https://api.github.com/rate_limit', { Authorization: `Bearer ${key}`, 'User-Agent': 'Osiris-Cockpit' });
        return res(service, r.ok, r.ok ? 'Connecté ✅' : r.status === 401 ? 'Token GitHub invalide (401)' : `Erreur ${r.status}`, r.status);
      }

      // ── OpenSanctions : recherche minimale avec la clé ──
      case 'opensanctions': {
        const key = val(req, 'opensanctions', 'OPENSANCTIONS_KEY');
        if (!key) return res(service, false, 'Aucune clé fournie');
        const r = await get('https://api.opensanctions.org/search/default?q=test&limit=1', { Authorization: `ApiKey ${key}` });
        return res(service, r.ok, r.ok ? 'Connecté ✅' : r.status === 401 || r.status === 403 ? 'Clé OpenSanctions refusée' : `Erreur ${r.status}`, r.status);
      }

      // ── AIS : gabarit d'URL (env, SSRF) + clé → un fetch réel ──
      case 'ais_key':
      case 'ais_url': {
        const tmpl = process.env.AIS_REST_URL || '';
        const key = val(req, 'ais_key', 'AIS_REST_KEY');
        if (!tmpl) return res(service, false, 'AIS_REST_URL doit être défini dans le .env du VPS (sécurité SSRF)');
        const url = tmpl.replace('{KEY}', encodeURIComponent(key)).replace('{MINLNG}', '1').replace('{MINLAT}', '43').replace('{MAXLNG}', '2').replace('{MAXLAT}', '44');
        const r = await get(url, { Accept: 'application/json' });
        return res(service, r.ok, r.ok ? 'Connecté ✅' : `Erreur source AIS ${r.status}`, r.status);
      }

      // ── Sources forme 2 : fournisseur variable → pas de test générique ──
      case 'cctv':
      case 'gpsjam':
      case 'scanner':
      case 'sigint':
      case 'telegram':
        return res(service, false, 'Test non disponible (source à câblage variable) — vérifier manuellement');

      default:
        return res(service, false, 'Service inconnu');
    }
  } catch (e) {
    return res(service, false, `Échec réseau: ${e instanceof Error ? e.message : 'erreur'}`);
  }
}
