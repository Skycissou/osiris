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

export const dynamic = 'force-dynamic';

// Clés attendues dans l'env (nom → à quoi elle sert). On ne révèle JAMAIS la
// valeur, seulement présence + longueur (assez pour détecter un copier-coller
// tronqué ou une variable vide).
const EXPECTED_ENV_KEYS: { env: string; usage: string }[] = [
  { env: 'FIRMS_MAP_KEY', usage: 'Feux (NASA FIRMS)' },
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

export function GET() {
  const env = EXPECTED_ENV_KEYS.map(({ env, usage }) => {
    const v = (process.env[env] ?? '').trim();
    return { env, usage, present: v.length > 0, len: v.length };
  });
  const envConfigured = env.filter((e) => e.present).length;

  return NextResponse.json(
    {
      env: { configured: envConfigured, total: env.length, keys: env },
      telemetry: telemetrySnapshot(),
      aircraftCollector: collectorHealth(),
      ts: Date.now(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
