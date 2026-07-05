'use client';

// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — SYSTÈME D'ALERTES (toasts temps réel)
//  ---------------------------------------------------------------------------
//  RÔLE
//    Surveille le store temps-réel par-clé (voir src/lib/store.ts) et émet des
//    ALERTES éphémères (toasts) quand un ÉVÉNEMENT franchit un seuil digne
//    d'attention. Deux flux sont câblés ici :
//      • Séismes (clé store 'earthquakes', source USGS) → alerte si magnitude
//        ≥ seuil (défaut 4.5). Sévérité graduée selon la magnitude.
//      • Avions VIP (clé store 'aircraft', champ `vip:true` posé par la route
//        /live-feed/fast) → alerte info à l'apparition d'un appareil suivi.
//
//  CONTRAT (côté composant — voir src/components/AlertToasts.tsx)
//    const { alerts, dismiss } = useAlertToasts();          // dans page.tsx
//    <AlertToasts alerts={alerts} onDismiss={dismiss} onFlyTo={...} />
//
//  PRINCIPES
//    • Ré-écriture CLEAN-ROOM : aucune ligne copiée de ShadowBroker (AGPL) ni
//      d'ailleurs. Seule l'idée « surveiller un store et notifier » est réutilisée.
//    • Anti-doublon : un Set d'ids déjà alertés empêche de re-notifier le même
//      événement à chaque poll (le store est ré-évalué toutes les ~15 s).
//    • Amorçage silencieux : au 1er passage, les événements DÉJÀ présents dans
//      le store sont marqués « vus » SANS émettre de toast — sinon l'ouverture
//      du cockpit (ou l'activation de la couche avions) déclencherait une pluie
//      de toasts. On ne notifie donc que les événements réellement NOUVEAUX.
//    • Auto-expiration : chaque alerte se retire seule après `autoDismissMs`.
//
//  CHARTE V3 (sévérités) — cf. severityColor() plus bas :
//    critique #db6f78 · élevé #d6a445 · info #54bdde · ok #5bc78d
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataKey } from './store';

// ── Types publics ──────────────────────────────────────────────────────────

/** Niveau de gravité d'une alerte (libellés FR, alignés sur la charte V3). */
export type AlertSeverity = 'critique' | 'eleve' | 'info' | 'ok';

/**
 * Une alerte affichable. Immuable une fois créée. `lat`/`lng` sont optionnels :
 * une alerte géolocalisée devient cliquable côté UI (fly-to sur la carte).
 */
export interface AlertItem {
  /** Identifiant STABLE, dérivé de l'événement source (anti-doublon). */
  id: string;
  /** Gravité → couleur + icône côté composant. */
  severity: AlertSeverity;
  /** Titre court FR, ex. `Séisme M5.2 — Sud de la Crète`. */
  title: string;
  /** Détail optionnel (2e ligne), ex. profondeur, indicatif de vol… */
  detail?: string;
  /** Latitude de l'événement (si géolocalisé) → active le fly-to. */
  lat?: number;
  /** Longitude de l'événement (si géolocalisé). */
  lng?: number;
  /** Horodatage de création de l'alerte (ms epoch). Sert au tri (récent d'abord). */
  ts: number;
}

/** Options de configuration du hook (toutes optionnelles). */
export interface AlertToastsOptions {
  /** Magnitude MINIMALE d'un séisme pour déclencher une alerte (défaut 4.5). */
  quakeMag?: number;
  /** Durée de vie d'un toast avant auto-retrait, en ms (défaut 6000). */
  autoDismissMs?: number;
}

/** Valeur de retour du hook : la pile d'alertes + le retrait manuel. */
export interface AlertToastsApi {
  /** Alertes actives, les plus RÉCENTES en tête (index 0). */
  alerts: AlertItem[];
  /** Retire immédiatement une alerte (bouton « fermer » du toast). */
  dismiss: (id: string) => void;
}

// ── Charte : sévérité → couleur hex (V3) ────────────────────────────────────

/**
 * Renvoie la couleur hex de la charte V3 associée à une sévérité.
 * Utilisée par le composant pour la barre latérale + l'icône du toast.
 *
 * Exemple : severityColor('critique') → '#db6f78'
 */
export function severityColor(severity: AlertSeverity): string {
  switch (severity) {
    case 'critique':
      return '#db6f78'; // rouge — danger
    case 'eleve':
      return '#d6a445'; // ambre — vigilance
    case 'ok':
      return '#5bc78d'; // vert — nominal / résolu
    case 'info':
    default:
      return '#54bdde'; // bleu accent — information
  }
}

/**
 * Mappe une magnitude sismique sur une sévérité (au-dessus du seuil de déclenchement).
 *   mag ≥ 6 → critique · mag ≥ 5 → élevé · sinon → info.
 */
function quakeSeverity(mag: number): AlertSeverity {
  if (mag >= 6) return 'critique';
  if (mag >= 5) return 'eleve';
  return 'info';
}

// ── Extraction TOLÉRANTE des données du store ───────────────────────────────
//  Les routes qui alimentent le store peuvent évoluer ; on lit les valeurs de
//  façon défensive (plusieurs formes acceptées) plutôt que de coupler dur au
//  format exact d'une route. Toute forme inattendue → tableau vide (pas de crash).

/** Séisme normalisé minimal, tel que consommé par le hook. */
interface QuakeNorm {
  id: string;
  mag: number;
  place: string;
  lat?: number;
  lng?: number;
}

/** Accès sûr à une propriété d'un objet inconnu. */
function prop(obj: unknown, key: string): unknown {
  if (obj && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
  return undefined;
}

/** Convertit une valeur inconnue en nombre fini, ou undefined. */
function toNum(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Extrait une liste de séismes normalisés depuis la valeur brute de la clé
 * store 'earthquakes'. Formes acceptées :
 *   • Array<QuakeNorm-like>      (déjà normalisé : {id, mag|magnitude, place, lat, lng})
 *   • GeoJSON FeatureCollection  (format USGS brut : {features:[{id, properties:{mag,place}, geometry:{coordinates:[lng,lat]}}]})
 * Retourne [] pour toute autre forme (pas de données, format inconnu…).
 */
function extractQuakes(raw: unknown): QuakeNorm[] {
  // Récupère le tableau de features / éléments quelle que soit l'enveloppe.
  let items: unknown[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (Array.isArray(prop(raw, 'features'))) items = prop(raw, 'features') as unknown[];
  else if (Array.isArray(prop(raw, 'earthquakes'))) items = prop(raw, 'earthquakes') as unknown[];
  else return [];

  const out: QuakeNorm[] = [];
  for (const it of items) {
    // GeoJSON : les attributs vivent dans `properties`; sinon objet à plat.
    const props = prop(it, 'properties') ?? it;
    const mag = toNum(prop(props, 'mag')) ?? toNum(prop(props, 'magnitude'));
    if (mag === undefined) continue; // sans magnitude exploitable → on ignore

    const place =
      (prop(props, 'place') as string) ||
      (prop(props, 'title') as string) ||
      (prop(it, 'title') as string) ||
      'lieu inconnu';

    // Coordonnées : GeoJSON [lng, lat, depth] en priorité, sinon champs à plat.
    let lat: number | undefined;
    let lng: number | undefined;
    const geoCoords = prop(prop(it, 'geometry'), 'coordinates');
    if (Array.isArray(geoCoords) && geoCoords.length >= 2) {
      lng = toNum(geoCoords[0]);
      lat = toNum(geoCoords[1]);
    } else {
      lat = toNum(prop(it, 'lat')) ?? toNum(prop(props, 'lat'));
      lng = toNum(prop(it, 'lng')) ?? toNum(prop(props, 'lng')) ?? toNum(prop(props, 'lon'));
    }

    // Id STABLE : id source > code > repli (place+mag). Indispensable à l'anti-doublon.
    const id =
      (prop(it, 'id') as string) ||
      (prop(props, 'id') as string) ||
      (prop(props, 'code') as string) ||
      `${place}|${mag}`;

    out.push({ id: String(id), mag, place, lat, lng });
  }
  return out;
}

/** Avion VIP normalisé minimal. */
interface VipNorm {
  id: string;
  vipName: string;
  lat?: number;
  lng?: number;
}

/**
 * Extrait les avions marqués `vip:true` depuis la valeur brute de la clé store
 * 'aircraft'. Formes acceptées : Array<Aircraft> (cas courant, cf. store) ou
 * enveloppe {aircraft:[...]}. Seuls les appareils VIP sont retournés.
 */
function extractVipAircraft(raw: unknown): VipNorm[] {
  let items: unknown[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (Array.isArray(prop(raw, 'aircraft'))) items = prop(raw, 'aircraft') as unknown[];
  else return [];

  const out: VipNorm[] = [];
  for (const it of items) {
    if (!prop(it, 'vip')) continue; // tout-venant → ignoré
    const id =
      (prop(it, 'id') as string) || (prop(it, 'hex') as string) || String(prop(it, 'callsign') ?? '');
    if (!id) continue;
    const vipName =
      (prop(it, 'vipName') as string) ||
      (prop(it, 'callsign') as string) ||
      (prop(it, 'hex') as string) ||
      'appareil suivi';
    out.push({
      id: String(id),
      vipName,
      lat: toNum(prop(it, 'lat')),
      lng: toNum(prop(it, 'lng')),
    });
  }
  return out;
}

// Formate proprement une magnitude pour l'affichage (M5.2, M6, …).
function fmtMag(mag: number): string {
  return `M${mag.toFixed(1).replace(/\.0$/, '')}`;
}

/** Plafond du Set anti-doublon (session longue) : au-delà, on purge les plus anciens. */
const SEEN_CAP = 2000;

// ── Hook principal ──────────────────────────────────────────────────────────

/**
 * useAlertToasts — surveille le store et produit une pile d'alertes toasts.
 *
 * @param opts.quakeMag       Magnitude mini d'un séisme pour alerter (défaut 4.5).
 * @param opts.autoDismissMs  Durée de vie d'un toast en ms (défaut 6000).
 * @returns { alerts, dismiss } — à passer à <AlertToasts>.
 *
 * Intégration type (dans page.tsx) :
 *   const { alerts, dismiss } = useAlertToasts();
 *   // …
 *   <AlertToasts
 *     alerts={alerts}
 *     onDismiss={dismiss}
 *     onFlyTo={({ lat, lng }) => setFlyToLocation({ lat, lng, ts: Date.now() })}
 *   />
 */
export function useAlertToasts(opts: AlertToastsOptions = {}): AlertToastsApi {
  const quakeMag = opts.quakeMag ?? 4.5;
  const autoDismissMs = opts.autoDismissMs ?? 6000;

  // Abonnement CIBLÉ aux deux clés surveillées : ce hook ne re-render que quand
  // 'earthquakes' ou 'aircraft' changent réellement (voir store par-clé).
  const earthquakes = useDataKey<unknown>('earthquakes');
  const aircraft = useDataKey<unknown>('aircraft');

  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  // Set des ids d'événements DÉJÀ traités (anti-doublon inter-poll). Ref → ne
  // provoque pas de re-render, persiste sur toute la vie du composant.
  const seenRef = useRef<Set<string>>(new Set());
  // Amorçage : true une fois la 1re valeur non-vide d'une clé consommée (silencieux).
  const primedQuakeRef = useRef(false);
  const primedVipRef = useRef(false);
  // Timers d'auto-expiration par id d'alerte (nettoyés au retrait / démontage).
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Retrait manuel ou programmé d'une alerte (idempotent).
  const dismiss = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  // Ajoute une alerte en tête de pile et programme son auto-expiration.
  const push = useCallback(
    (item: AlertItem) => {
      setAlerts((prev) => [item, ...prev]);
      const timer = setTimeout(() => dismiss(item.id), autoDismissMs);
      timersRef.current.set(item.id, timer);
    },
    [autoDismissMs, dismiss],
  );

  // Marque un id comme « vu » (anti-doublon), avec purge douce si le Set enfle.
  const markSeen = useCallback((key: string) => {
    const set = seenRef.current;
    set.add(key);
    if (set.size > SEEN_CAP) {
      // Set conserve l'ordre d'insertion : on retire les plus anciens.
      const drop = set.size - SEEN_CAP;
      let i = 0;
      for (const k of set) {
        if (i++ >= drop) break;
        set.delete(k);
      }
    }
  }, []);

  // ── Surveillance des SÉISMES ──────────────────────────────────────────────
  useEffect(() => {
    const quakes = extractQuakes(earthquakes);
    if (quakes.length === 0) return;

    // 1er lot non-vide : on amorce en silence (marque tout « vu », zéro toast).
    if (!primedQuakeRef.current) {
      for (const q of quakes) markSeen(`quake:${q.id}`);
      primedQuakeRef.current = true;
      return;
    }

    for (const q of quakes) {
      const key = `quake:${q.id}`;
      if (seenRef.current.has(key)) continue; // déjà traité → pas de re-notif
      if (q.mag < quakeMag) continue; // sous le seuil → ni alerte ni « vu » (peu coûteux)
      markSeen(key);
      const severity = quakeSeverity(q.mag);
      push({
        id: key,
        severity,
        title: `Séisme ${fmtMag(q.mag)} — ${q.place}`,
        detail: q.lat !== undefined && q.lng !== undefined
          ? `${q.lat.toFixed(2)}, ${q.lng.toFixed(2)}`
          : undefined,
        lat: q.lat,
        lng: q.lng,
        ts: Date.now(),
      });
    }
  }, [earthquakes, quakeMag, push, markSeen]);

  // ── Surveillance des AVIONS VIP ───────────────────────────────────────────
  useEffect(() => {
    const vips = extractVipAircraft(aircraft);
    if (vips.length === 0) return;

    // Amorçage silencieux du 1er lot (évite la pluie de toasts à l'activation).
    if (!primedVipRef.current) {
      for (const v of vips) markSeen(`vip:${v.id}`);
      primedVipRef.current = true;
      return;
    }

    for (const v of vips) {
      const key = `vip:${v.id}`;
      if (seenRef.current.has(key)) continue;
      markSeen(key);
      push({
        id: key,
        severity: 'info',
        title: `VIP en vol — ${v.vipName}`,
        detail: v.lat !== undefined && v.lng !== undefined
          ? `${v.lat.toFixed(2)}, ${v.lng.toFixed(2)}`
          : undefined,
        lat: v.lat,
        lng: v.lng,
        ts: Date.now(),
      });
    }
  }, [aircraft, push, markSeen]);

  // Nettoyage : purge tous les timers d'expiration au démontage.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  return { alerts, dismiss };
}
