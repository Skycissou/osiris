// ─────────────────────────────────────────────────────────────────────────────
//  geopoliticsOpen.ts — Couche GÉOPOLITIQUE « open / commercial-safe »
//
//  Contexte (décision Cissou 12/07) : OSIRIS aura DEUX usages (ARPD non-commercial
//  ET produit potentiellement commercial). ACLED = licence NON-commerciale →
//  réservé à l'ARPD (activé seulement si clé présente). Pour le build général, on
//  utilise une source SANS souci de licence : l'ACTUALITÉ des conflits.
//
//  Principe : on interroge Google Actualités (RSS public, qui MARCHE depuis le VPS
//  contrairement à GDELT) sur des termes de conflit, puis on positionne chaque
//  article sur la carte via un GAZETTEER déterministe de zones de conflit
//  (pays/hotspots → coordonnées). Pas de clé, temps réel, on n'affiche que des
//  LIENS d'actu (pas de revente de données) → propre même en usage commercial.
//
//  Sortie : même forme que la couche géo (id/lat/lng/name/title/url/goldstein…)
//  → rendu carte inchangé.
// ─────────────────────────────────────────────────────────────────────────────

import { recordCall } from '@/lib/telemetry';
import type { GeoConflictEvent } from '@/lib/acledEvents';

const RSS_URL =
  'https://news.google.com/rss/search?q=' +
  encodeURIComponent('guerre OR conflit OR frappe OR offensive OR bombardement OR affrontements OR "cessez-le-feu" when:3d') +
  '&hl=fr&gl=FR&ceid=FR:fr';
const TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 20 * 60_000;
const MAX_POINTS = 200;

// Gazetteer déterministe : zone de conflit → point représentatif. `k` = motifs à
// détecter dans le titre (minuscule, sans accent). Ordre = priorité (le 1er trouvé
// gagne). Couvre les foyers récurrents ; extensible facilement.
const GAZETTEER: { name: string; lat: number; lng: number; k: string[] }[] = [
  { name: 'Ukraine', lat: 49.0, lng: 32.0, k: ['ukrain', 'kyiv', 'kiev', 'kharkiv', 'donbass', 'zaporij', 'kherson', 'odessa', 'odes'] },
  { name: 'Russie', lat: 55.75, lng: 37.62, k: ['russ', 'moscou', 'kremlin', 'belgorod'] },
  { name: 'Gaza / Israël', lat: 31.5, lng: 34.47, k: ['gaza', 'israel', 'israël', 'hamas', 'cisjordanie', 'tel-aviv', 'tel aviv', 'rafah'] },
  { name: 'Liban', lat: 33.89, lng: 35.5, k: ['liban', 'beyrouth', 'hezbollah'] },
  { name: 'Iran', lat: 35.7, lng: 51.42, k: ['iran', 'teheran', 'téhéran'] },
  { name: 'Syrie', lat: 34.8, lng: 38.9, k: ['syri', 'damas', 'alep'] },
  { name: 'Yémen', lat: 15.35, lng: 44.2, k: ['yemen', 'yémen', 'houthi', 'sanaa'] },
  { name: 'Irak', lat: 33.31, lng: 44.36, k: ['irak', 'bagdad', 'mossoul'] },
  { name: 'Soudan', lat: 15.5, lng: 32.56, k: ['soudan', 'khartoum', 'darfour'] },
  { name: 'Éthiopie', lat: 9.15, lng: 40.49, k: ['ethiopi', 'éthiopi', 'tigr', 'addis'] },
  { name: 'RD Congo', lat: -2.5, lng: 28.85, k: ['congo', 'goma', 'kivu', 'm23', 'rdc'] },
  { name: 'Sahel / Mali', lat: 17.57, lng: -3.99, k: ['mali', 'bamako', 'sahel', 'jnim'] },
  { name: 'Burkina Faso', lat: 12.24, lng: -1.56, k: ['burkina', 'ouagadougou'] },
  { name: 'Niger', lat: 17.6, lng: 8.08, k: ['niger', 'niamey'] },
  { name: 'Nigeria', lat: 9.08, lng: 8.68, k: ['nigeria', 'boko haram', 'abuja'] },
  { name: 'Somalie', lat: 5.15, lng: 46.2, k: ['somali', 'mogadiscio', 'shabab', 'chabab'] },
  { name: 'Myanmar', lat: 21.9, lng: 95.96, k: ['birmanie', 'myanmar', 'rangoun', 'naypyidaw'] },
  { name: 'Afghanistan', lat: 34.53, lng: 69.17, k: ['afghan', 'kaboul', 'taliban'] },
  { name: 'Pakistan', lat: 33.69, lng: 73.06, k: ['pakistan', 'islamabad', 'baloutch'] },
  { name: 'Haïti', lat: 18.59, lng: -72.31, k: ['haiti', 'haïti', 'port-au-prince'] },
  { name: 'Taïwan / détroit', lat: 23.7, lng: 120.96, k: ['taiwan', 'taïwan', 'taipei', 'detroit de taiwan'] },
  { name: 'Corée', lat: 39.03, lng: 125.75, k: ['coree du nord', 'corée du nord', 'pyongyang', 'coree'] },
  { name: 'Arménie / Caucase', lat: 39.9, lng: 46.7, k: ['armeni', 'arménie', 'azerbaidjan', 'azerbaïdjan', 'karabakh', 'haut-karabakh'] },
  { name: 'Colombie', lat: 4.6, lng: -74.08, k: ['colombie', 'bogota', 'farc'] },
  { name: 'Mexique', lat: 19.43, lng: -99.13, k: ['mexique', 'cartel', 'sinaloa'] },
];

const G = globalThis as unknown as { __osirisGeoOpen?: { ts: number; events: GeoConflictEvent[] } | null };
if (G.__osirisGeoOpen === undefined) G.__osirisGeoOpen = null;

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** Toujours dispo (aucune clé). [] si le flux est injoignable. */
export async function getOpenGeopoliticsEvents(): Promise<GeoConflictEvent[]> {
  const now = Date.now();
  if (G.__osirisGeoOpen && now - G.__osirisGeoOpen.ts < CACHE_TTL_MS) return G.__osirisGeoOpen.events;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(RSS_URL, { signal: controller.signal, headers: { Accept: 'application/rss+xml,application/xml', 'User-Agent': 'OSIRIS-cockpit/geopolitique' } });
    if (!res.ok) {
      recordCall({ source: 'geo-news', ok: false, status: res.status, ms: Date.now() - started, note: `HTTP ${res.status}` });
      return G.__osirisGeoOpen?.events ?? [];
    }
    const xml = await res.text();
    const items = xml.split('<item>').slice(1);
    const events: GeoConflictEvent[] = [];
    const perZone = new Map<string, number>(); // cap par zone (évite 50 pins sur Gaza)
    for (const raw of items) {
      if (events.length >= MAX_POINTS) break;
      const title = decodeXml((raw.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim());
      const link = (raw.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim();
      if (!title) continue;
      const t = norm(title);
      const zone = GAZETTEER.find((z) => z.k.some((kw) => t.includes(kw)));
      if (!zone) continue; // pas de zone identifiée → pas de pin (on n'invente rien)
      const n = perZone.get(zone.name) || 0;
      if (n >= 6) continue; // max 6 articles par zone
      perZone.set(zone.name, n + 1);
      // Léger éclatement autour du point de zone pour ne pas empiler pile au même px.
      const jitter = (seed: number) => ((seed % 100) / 100 - 0.5) * 0.6;
      events.push({
        id: `geonews:${zone.name}:${events.length}`,
        lat: zone.lat + jitter(title.length * 7 + n),
        lng: zone.lng + jitter(title.length * 13 + n * 3),
        name: zone.name,
        title,
        url: link || undefined,
        goldstein: -6, // actualité de conflit → gravité négative (code couleur rouge)
      });
    }
    G.__osirisGeoOpen = { ts: now, events };
    recordCall({ source: 'geo-news', ok: true, status: 200, ms: Date.now() - started, count: events.length, note: `${items.length} articles` });
    return events;
  } catch (e) {
    recordCall({ source: 'geo-news', ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
    return G.__osirisGeoOpen?.events ?? [];
  } finally {
    clearTimeout(timer);
  }
}
