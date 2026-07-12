// ─────────────────────────────────────────────────────────────────────────────
//  /live-feed/diag — MONITORING (demande Cissou 07/07)
//
//  Renvoie l'état de TOUTES les requêtes amont du cockpit : compteurs ok/échec
//  par source (adsb.lol, USGS, celestrak, gdelt-doc/export, abuse.ch, opensky,
//  FIRMS…), latences, 40 derniers appels + santé du collecteur d'avions.
//
//  + bloc `env` : pour CHAQUE clé attendue dans /docker/osiris-v4/.env, indique
//  si elle est ENREGISTRÉE côté serveur (present + longueur) — JAMAIS la valeur.
//  → permet à Cissou de vérifier que la « barrière d'environnement » est bien
//  chargée, sans re-chercher ses clés ni déclencher les couches.
//
//  URL finale : /cockpit/live-feed/diag (basePath ; JAMAIS /api/* — Traefik).
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { telemetrySnapshot } from '@/lib/telemetry';
import { collectorHealth } from '@/lib/aircraftCollector';
import { ensureKeysLoaded, serverKeyStatus } from '@/lib/serverKeyStore';

export const dynamic = 'force-dynamic';

// Clés attendues dans l'env (nom → à quoi elle sert). On ne révèle JAMAIS la
// valeur, seulement présence + longueur (assez pour détecter un copier-coller
// tronqué ou une variable vide).
const EXPECTED_ENV_KEYS: { env: string; usage: string }[] = [
  { env: 'FIRMS_MAP_KEY', usage: 'Feux (NASA FIRMS)' },
  { env: 'ACLED_KEY', usage: 'Géopolitique / conflits (ACLED)' },
  { env: 'ACLED_EMAIL', usage: 'Géopolitique / conflits (ACLED — email associé)' },
  { env: 'OPENSKY_CLIENT_ID', usage: 'Avions vue monde (OpenSky)' },
  { env: 'OPENSKY_CLIENT_SECRET', usage: 'Avions vue monde (OpenSky)' },
  { env: 'AIS_REST_URL', usage: 'Navires (AIS) — gabarit URL' },
  { env: 'AIS_REST_KEY', usage: 'Navires (AIS) — clé' },
  { env: 'SHODAN_KEY', usage: 'OSINT Shodan' },
  { env: 'HIBP_KEY', usage: 'OSINT fuites (HaveIBeenPwned)' },
  { env: 'ABUSEIPDB_KEY', usage: 'OSINT réputation IP' },
  { env: 'GITHUB_TOKEN', usage: 'OSINT GitHub (quota)' },
  { env: 'OPENSANCTIONS_KEY', usage: 'OSINT sanctions (quota)' },
  { env: 'CCTV_SOURCE_KEY', usage: 'Caméras (forme 2)' },
  { env: 'GPSJAM_KEY', usage: 'Brouillage GPS (forme 2)' },
  { env: 'SCANNER_KEY', usage: 'Scanners radio (forme 2)' },
  { env: 'SIGINT_KEY', usage: 'Mesh/APRS (forme 2)' },
  { env: 'TELEGRAM_OSINT_KEY', usage: 'Flux Telegram (forme 2)' },
  { env: 'LLM_API_KEY', usage: 'Briefing IA (dormant)' },
];

export async function GET() {
  const env = EXPECTED_ENV_KEYS.map(({ env, usage }) => {
    const v = (process.env[env] ?? '').trim();
    return { env, usage, present: v.length > 0, len: v.length };
  });
  const envConfigured = env.filter((e) => e.present).length;

  // Coffre serveur (page admin) — clés « couches » persistées côté serveur,
  // visibles ici sans révéler la valeur. C'est CE bloc qui doit être rempli pour
  // qu'un utilisateur ait OpenSky/FIRMS/AIS sans SSH.
  await ensureKeysLoaded();
  const store = serverKeyStatus();

  return NextResponse.json(
    {
      env: {
        configured: envConfigured,
        total: env.length,
        keys: env,
        // ⚠️ Ce bloc ne reflète QUE le .env SERVEUR. Les clés saisies dans l'app
        // (navigateur/localStorage) ne sont PAS visibles ici — elles voyagent en
        // en-tête par requête. Donc `present:false` ≠ « pas de clé » : une couche
        // à la demande (FIRMS, Shodan…) peut marcher avec la clé navigateur seule.
        // EXCEPTION : OpenSky. Son collecteur d'avions tourne EN PERMANENCE côté
        // serveur (sans requête) → il lui faut la clé dans le .env serveur pour la
        // vue monde durable (sinon `aircraftCollector.lastGlobalAgeS` reste null).
        note: 'Reflète UNIQUEMENT le .env serveur. Les clés saisies dans l’app (navigateur) ne figurent pas ici (elles marchent en en-tête, par requête). OpenSky vue monde EXIGE le .env serveur (collecteur permanent).',
      },
      serverStore: {
        note: 'Coffre serveur (page admin /cockpit/admin). Clés « couches » persistées côté serveur → OpenSky/FIRMS/AIS sans SSH. Valeur jamais exposée.',
        keys: store,
      },
      telemetry: telemetrySnapshot(),
      aircraftCollector: collectorHealth(),
      ts: Date.now(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
