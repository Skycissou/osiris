// ─────────────────────────────────────────────────────────────────────────────
//  acledEvents.ts — Couche GÉOPOLITIQUE via ACLED (conflits armés mondiaux)
//
//  Pourquoi : GDELT est BLOQUÉ depuis l'IP du VPS (0 succès, cf. diag). ACLED
//  (Armed Conflict Location & Event Data) est LA base de référence des conflits,
//  géoréférencée et à jour (hebdo). Nécessite une clé gratuite + l'email associé.
//    Clé : https://developer.acleddata.com  → ACLED_KEY + ACLED_EMAIL (.env VPS)
//
//  Sortie : même forme que la couche géopo existante (id/lat/lng/name/title/
//  goldstein/actor1/actor2) → le rendu carte est INCHANGÉ. On fabrique un
//  `goldstein` synthétique (gravité) depuis le type d'événement + les morts,
//  pour garder le code couleur « rouge = déstabilisant ».
//
//  Absente de clé → `acledConfigured()` = false, le flux lent retombe sur GDELT.
// ─────────────────────────────────────────────────────────────────────────────

import { recordCall } from '@/lib/telemetry';

/** Même forme que GdeltEvent (contrat carte). */
export interface GeoConflictEvent {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  count?: number;
  title?: string;
  url?: string;
  tone?: number;
  goldstein?: number; // gravité synthétique (-10..+10), négatif = déstabilisant
  actor1?: string;
  actor2?: string;
}

const ENDPOINT = 'https://api.acleddata.com/acled/read';
const LOOKBACK_DAYS = 30;
const LIMIT = 800;
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 60 * 60_000; // ACLED = maj hebdo → 1 h de cache large

/** Clé + email présents ? (ACLED exige les deux). */
export function acledConfigured(): boolean {
  return !!(process.env.ACLED_KEY || '').trim() && !!(process.env.ACLED_EMAIL || '').trim();
}

// Gravité par type d'événement (base), affinée par le nombre de morts.
const TYPE_GRAVITY: Record<string, number> = {
  Battles: -8,
  'Explosions/Remote violence': -8,
  'Violence against civilians': -7,
  Riots: -5,
  'Strategic developments': -3,
  Protests: -2,
};
function synthGoldstein(eventType: string, fatalities: number): number {
  const base = TYPE_GRAVITY[eventType] ?? -4;
  const deadPenalty = Math.min(2, Math.log10(1 + Math.max(0, fatalities))); // 0..2
  return Math.max(-10, base - deadPenalty);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const G = globalThis as unknown as { __osirisAcled?: { ts: number; events: GeoConflictEvent[] } | null };
if (G.__osirisAcled === undefined) G.__osirisAcled = null;

interface AcledRow {
  event_id_cnty?: string; event_date?: string; event_type?: string; sub_event_type?: string;
  actor1?: string; actor2?: string; country?: string; location?: string;
  latitude?: string; longitude?: string; fatalities?: string; notes?: string;
}

/** Événements de conflit récents (cache 1 h). [] si non configuré ou erreur. */
export async function getAcledEvents(): Promise<GeoConflictEvent[]> {
  if (!acledConfigured()) return [];
  const now = Date.now();
  if (G.__osirisAcled && now - G.__osirisAcled.ts < CACHE_TTL_MS) return G.__osirisAcled.events;

  const key = (process.env.ACLED_KEY || '').trim();
  const email = (process.env.ACLED_EMAIL || '').trim();
  const from = ymd(new Date(now - LOOKBACK_DAYS * 864e5));
  const to = ymd(new Date(now));
  const fields = 'event_id_cnty|event_date|event_type|sub_event_type|actor1|actor2|country|location|latitude|longitude|fatalities|notes';
  const url =
    `${ENDPOINT}?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}` +
    `&event_date=${from}|${to}&event_date_where=BETWEEN&fields=${encodeURIComponent(fields)}` +
    `&limit=${LIMIT}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'OSIRIS-cockpit/geopolitique' } });
    if (!res.ok) {
      recordCall({ source: 'acled', ok: false, status: res.status, ms: Date.now() - started, note: `HTTP ${res.status}` });
      return G.__osirisAcled?.events ?? [];
    }
    const j = (await res.json()) as { data?: AcledRow[] };
    const rows = Array.isArray(j.data) ? j.data : [];
    const seen = new Set<string>();
    const events: GeoConflictEvent[] = [];
    for (const r of rows) {
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
      const id = r.event_id_cnty ? `acled:${r.event_id_cnty}` : `acled:${lat.toFixed(3)},${lng.toFixed(3)},${r.event_date || ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const fatalities = Number(r.fatalities) || 0;
      const eventType = (r.event_type || '').trim();
      const sub = (r.sub_event_type || '').trim();
      const place = (r.location || r.country || '').trim();
      events.push({
        id,
        lat,
        lng,
        name: place || undefined,
        count: Math.max(1, fatalities),
        title: [eventType || 'Événement', sub && sub !== eventType ? `(${sub})` : '', place ? `· ${place}` : '', fatalities ? `· ${fatalities} mort(s)` : ''].filter(Boolean).join(' ').trim(),
        goldstein: eventType ? synthGoldstein(eventType, fatalities) : -4,
        ...(r.actor1 && r.actor1.trim() ? { actor1: r.actor1.trim() } : {}),
        ...(r.actor2 && r.actor2.trim() ? { actor2: r.actor2.trim() } : {}),
      });
    }
    G.__osirisAcled = { ts: now, events };
    recordCall({ source: 'acled', ok: true, status: 200, ms: Date.now() - started, count: events.length, note: `${LOOKBACK_DAYS}j` });
    return events;
  } catch (e) {
    recordCall({ source: 'acled', ok: false, ms: Date.now() - started, note: e instanceof Error ? e.message : 'error' });
    return G.__osirisAcled?.events ?? []; // stale-on-error
  } finally {
    clearTimeout(timer);
  }
}
