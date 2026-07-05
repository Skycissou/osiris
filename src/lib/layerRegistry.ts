/**
 * layerRegistry.ts — Registre déclaratif des couches carte du cockpit OSIRIS V4.
 * ---------------------------------------------------------------------------
 * Implémentation CLEAN-ROOM (pattern « registre déclaratif de couches »).
 *   • Inspirée du *pattern* ShadowBroker (source AGPL) mais RÉ-ÉCRITE from
 *     scratch : aucun fichier ni bloc de code n'a été copié. Seule l'idée
 *     générale — décrire les couches comme des DONNÉES, pas comme du code —
 *     est reproduite ici.
 *   • Fichier livré sous licence MIT (repo OSIRIS).
 *
 * OBJECTIF
 *   Rendre l'ajout d'une couche trivial : on ajoute UNE entrée dans `sections`
 *   ci-dessous, pas une ligne de logique dans un composant. Le `<LayerPanel>`
 *   consomme ce registre et se contente d'afficher / basculer les couches.
 *
 * FORMES (form 1 vs form 2) — le point important
 *   OSIRIS a deux « formes » d'usage :
 *     - form 1 = TOUT-PUBLIC. Couches OSINT ouvertes, sans consentement.
 *     - form 2 = PERSO / ENQUÊTEUR. Couches `sensitive: true` réservées à un
 *       usage opt-in, derrière consentement explicite. Elles sont DÉCLARÉES
 *       ici pour la structure mais ne DOIVENT JAMAIS être exposées dans la
 *       forme tout-public (form 1). L'activation réelle passera plus tard par
 *       une modale de consentement (hors scope de ce fichier).
 *
 * ─── Comment brancher sur un <LayerPanel> (API, pas de câblage ici) ───
 *   import {
 *     sections, publicLayers, buildDefaultActiveLayers,
 *     toggleLayer, getLayer, type ActiveLayers,
 *   } from '@/lib/layerRegistry';
 *
 *   // 1. État initial (tout false sauf fonds de référence de base) :
 *   const [active, setActive] = useState<ActiveLayers>(
 *     () => buildDefaultActiveLayers(sections)
 *   );
 *
 *   // 2. Ne montrer que la forme tout-public dans le panneau standard :
 *   const visibles = publicLayers(sections); // form 1 uniquement
 *
 *   // 3. Basculer une couche (immutable) :
 *   const onToggle = (id: string) => setActive((a) => toggleLayer(a, id));
 *
 *   // 4. Retrouver la déf d'une couche pour piloter la carte :
 *   const def = getLayer(sections, 'aircraft_civil'); // → LayerDef | undefined
 *
 *   La forme 2 (sensitiveLayers) ne sera rendue qu'après consentement.
 */

// ──────────────────────────────────────────────────────────────────────────
//  Charte couleurs OSIRIS V3 (rappel — réutilisées dans le catalogue)
// ──────────────────────────────────────────────────────────────────────────
export const OSIRIS_COLORS = {
  accent: '#54bdde', // bleu principal
  bright: '#9bdcf0', // bleu clair
  green: '#5bc78d',
  amber: '#d6a445',
  red: '#db6f78',
  violet: '#9a8cef',
} as const;

// ──────────────────────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────────────────────

/**
 * LayerDef — description déclarative d'une couche.
 *   id         : identifiant canonique (clé dans ActiveLayers, matche la carte).
 *   name       : libellé affiché.
 *   source     : nom court de la source de données (adsb.lol, USGS…).
 *   sourceUrl  : URL de base de l'API / du flux (optionnel).
 *   icon       : nom d'icône (ex. clé lucide-react), optionnel — résolu côté UI.
 *   count      : compteur d'objets si connu (rempli dynamiquement, optionnel).
 *   sensitive  : true = couche à usage restreint (voir `form`).
 *   form       : 1 = tout-public · 2 = perso/enquêteur (opt-in + consentement).
 *                `sensitive:true` + `form:2` ⇒ JAMAIS exposée dans la forme 1.
 *   color      : couleur d'accent de la couche (charte OSIRIS).
 */
export interface LayerDef {
  id: string;
  name: string;
  source: string;
  sourceUrl?: string;
  icon?: string;
  count?: number;
  sensitive?: boolean;
  form?: 1 | 2;
  color?: string;
}

/** LayerSection — regroupement thématique de couches dans le panneau. */
export interface LayerSection {
  label: string;
  icon?: string;
  layers: LayerDef[];
}

// ──────────────────────────────────────────────────────────────────────────
//  Catalogue déclaratif
//  ➜ Ajouter une couche = ajouter une entrée ici. Rien d'autre.
// ──────────────────────────────────────────────────────────────────────────
export const sections: LayerSection[] = [
  // ── Cartographie IGN ────────────────────────────────────────────────────
  // Fonds & surcouches WMTS Géoplateforme IGN (data.geopf.fr), modélisés
  // d'après OsirisMap.tsx. Toutes en form 1 (données publiques ouvertes).
  {
    label: 'Cartographie IGN',
    icon: 'Map',
    layers: [
      // Fonds raster (un seul « fond » visible à la fois côté carte, mais
      // déclarés comme couches sélectionnables ici).
      { id: 'ign_plan', name: 'Plan IGN v2', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Map', form: 1, color: OSIRIS_COLORS.accent },
      { id: 'ign_ortho', name: 'Ortho-photographies', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Satellite', form: 1, color: OSIRIS_COLORS.bright },
      { id: 'ign_scan25', name: 'SCAN 25 Tourisme', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Mountain', form: 1, color: OSIRIS_COLORS.green },
      // Surcouches thématiques (empilables).
      { id: 'ign_cadastre', name: 'Cadastre (parcellaire)', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Grid', form: 1, color: OSIRIS_COLORS.amber },
      { id: 'ign_admin', name: 'Limites administratives', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Landmark', form: 1, color: OSIRIS_COLORS.violet },
      { id: 'ign_hydro', name: 'Hydrographie', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Waves', form: 1, color: OSIRIS_COLORS.bright },
      { id: 'ign_routes', name: 'Réseau routier', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Route', form: 1, color: OSIRIS_COLORS.amber },
      { id: 'ign_rail', name: 'Réseau ferré', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'TrainFront', form: 1, color: OSIRIS_COLORS.green },
      { id: 'ign_forets', name: 'Forêts publiques', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'Trees', form: 1, color: OSIRIS_COLORS.green },
      { id: 'ign_protected', name: 'Aires protégées', source: 'IGN Géoplateforme', sourceUrl: 'https://data.geopf.fr/wmts', icon: 'ShieldCheck', form: 1, color: OSIRIS_COLORS.green },
    ],
  },

  // ── Aérien ───────────────────────────────────────────────────────────────
  // Trafic aérien public (ADS-B). Tout-public (form 1).
  {
    label: 'Aérien',
    icon: 'Plane',
    layers: [
      { id: 'aircraft_civil', name: 'Aéronefs civils', source: 'adsb.lol', sourceUrl: 'https://api.adsb.lol/v2/', icon: 'Plane', form: 1, color: OSIRIS_COLORS.accent },
      // VIP : public mais mis en avant (watchlist) — couleur accent.
      { id: 'aircraft_vip', name: 'Aéronefs VIP (watchlist)', source: 'adsb.lol', sourceUrl: 'https://api.adsb.lol/v2/', icon: 'Star', form: 1, color: OSIRIS_COLORS.accent },
    ],
  },

  // ── Maritime ─────────────────────────────────────────────────────────────
  {
    label: 'Maritime',
    icon: 'Ship',
    layers: [
      { id: 'ships', name: 'Navires (AIS public)', source: 'AIS public', icon: 'Ship', form: 1, color: OSIRIS_COLORS.bright },
    ],
  },

  // ── Géophysique ──────────────────────────────────────────────────────────
  // Aléas naturels — flux ouverts (USGS, NASA FIRMS…). Tout-public (form 1).
  {
    label: 'Géophysique',
    icon: 'Activity',
    layers: [
      { id: 'earthquakes', name: 'Séismes', source: 'USGS', sourceUrl: 'https://earthquake.usgs.gov/earthquakes/feed/', icon: 'Activity', form: 1, color: OSIRIS_COLORS.amber },
      { id: 'wildfires', name: 'Feux de forêt', source: 'NASA FIRMS', icon: 'Flame', form: 1, color: OSIRIS_COLORS.red },
      { id: 'volcanoes', name: 'Volcans', source: 'Smithsonian GVP', icon: 'Mountain', form: 1, color: OSIRIS_COLORS.violet },
    ],
  },

  // ── Sensibles (forme 2 — perso / enquêteur) ──────────────────────────────
  // DÉCLARÉES ici pour la structure du registre, mais `sensitive:true` +
  // `form:2` : elles ne sont JAMAIS servies à la forme tout-public. Leur
  // activation réelle passera par une modale de consentement (à venir).
  {
    label: 'Sensibles (forme 2)',
    icon: 'ShieldAlert',
    layers: [
      { id: 'cctv', name: 'Caméras (CCTV)', source: 'OSINT restreint', icon: 'Cctv', sensitive: true, form: 2, color: OSIRIS_COLORS.red },
      { id: 'gps_jamming', name: 'Brouillage GPS', source: 'OSINT restreint', icon: 'Radar', sensitive: true, form: 2, color: OSIRIS_COLORS.amber },
      { id: 'scanners', name: 'Scanners radio', source: 'OSINT restreint', icon: 'RadioTower', sensitive: true, form: 2, color: OSIRIS_COLORS.violet },
      { id: 'sigint_mesh', name: 'Maillage SIGINT', source: 'OSINT restreint', icon: 'Network', sensitive: true, form: 2, color: OSIRIS_COLORS.bright },
      { id: 'military_bases', name: 'Emprises militaires', source: 'OSINT restreint', icon: 'Shield', sensitive: true, form: 2, color: OSIRIS_COLORS.red },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
//  État d'activation
// ──────────────────────────────────────────────────────────────────────────

/** Table id → actif. */
export type ActiveLayers = Record<string, boolean>;

/**
 * Fonds de référence de base activés par défaut.
 * CHOIX : seul le « Plan IGN v2 » (`ign_plan`) démarre à true — c'est le fond
 * de carte neutre attendu à l'ouverture du cockpit. Tout le reste (surcouches,
 * couches OSINT, couches sensibles) démarre à false : rien de sensible n'est
 * jamais actif sans action explicite.
 */
export const BASE_REFERENCE_LAYER_IDS: readonly string[] = ['ign_plan'];

/**
 * Construit l'état initial : toutes les couches à false, sauf les fonds de
 * référence de base (`defaultsOn`, par défaut BASE_REFERENCE_LAYER_IDS).
 * Les couches sensibles (form 2) restent TOUJOURS false ici, même si listées
 * dans `defaultsOn` — garde-fou de forme.
 */
export function buildDefaultActiveLayers(
  secs: LayerSection[] = sections,
  defaultsOn: readonly string[] = BASE_REFERENCE_LAYER_IDS,
): ActiveLayers {
  const active: ActiveLayers = {};
  for (const section of secs) {
    for (const layer of section.layers) {
      const on = defaultsOn.includes(layer.id) && layer.form !== 2 && !layer.sensitive;
      active[layer.id] = on;
    }
  }
  return active;
}

/**
 * Bascule une couche de façon IMMUTABLE : renvoie un nouvel objet, sans muter
 * l'entrée reçue (adapté à un setState React).
 */
export function toggleLayer(active: ActiveLayers, id: string): ActiveLayers {
  return { ...active, [id]: !active[id] };
}

// ──────────────────────────────────────────────────────────────────────────
//  Helpers de lecture / filtrage
// ──────────────────────────────────────────────────────────────────────────

/** Liste plate de tous les ids de couches du catalogue. */
export function allLayerIds(secs: LayerSection[] = sections): string[] {
  return secs.flatMap((section) => section.layers.map((layer) => layer.id));
}

/** Retrouve une couche par id (undefined si absente). */
export function getLayer(secs: LayerSection[], id: string): LayerDef | undefined {
  for (const section of secs) {
    const found = section.layers.find((layer) => layer.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * Couches de la forme TOUT-PUBLIC (form 1) : tout ce qui n'est ni sensible ni
 * marqué form 2. C'est ce que le panneau standard doit afficher.
 */
export function publicLayers(secs: LayerSection[] = sections): LayerDef[] {
  return secs
    .flatMap((section) => section.layers)
    .filter((layer) => layer.form !== 2 && !layer.sensitive);
}

/**
 * Couches SENSIBLES (forme perso / enquêteur, form 2). À ne rendre qu'après
 * consentement explicite (modale à venir).
 */
export function sensitiveLayers(secs: LayerSection[] = sections): LayerDef[] {
  return secs
    .flatMap((section) => section.layers)
    .filter((layer) => layer.sensitive === true || layer.form === 2);
}
