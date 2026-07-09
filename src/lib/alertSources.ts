// ─────────────────────────────────────────────────────────────────────────────
//  alertSources.ts — REGISTRE UNIQUE des sources d'« Alertes disparitions ».
//
//  ⭐ SOURCE DE VÉRITÉ. Pour ajouter une source : UNE entrée ici, rien d'autre.
//  Tout en dérive automatiquement :
//    • la whitelist d'ingest (alertsStore.ALERT_SOURCES / isAlertSource) ;
//    • les chips de filtre + leurs libellés (AlertsControlBar) ;
//    • le libellé « Source : … » de la fiche carte (OsirisMap) ;
//    • la catégorie par défaut si le parser n8n n'en fournit pas.
//
//  Aucune dépendance serveur (fs/net) ici → importable côté client ET serveur.
//  Le mapping n8n (quel slug envoyer) est documenté pour chat en fin de fichier.
// ─────────────────────────────────────────────────────────────────────────────

export interface AlertSourceDef {
  /** Slug technique (clé stable, envoyée par n8n dans le champ `source`). */
  slug: string;
  /** Libellé court des chips de filtre. */
  label: string;
  /** Libellé complet affiché dans la fiche carte (« Source : … »). */
  fullLabel: string;
  /** Catégorie retenue si l'avis n'en porte pas (validée côté store). */
  defaultCategorie: string;
}

// `as const` : les slugs deviennent un type union (sécurité de type sans coût).
export const ALERT_SOURCE_REGISTRY = [
  { slug: 'interpol_yellow', label: 'Interpol', fullLabel: 'Interpol (Yellow Notice)', defaultCategorie: 'disparition' },
  { slug: 'x116000', label: '116000', fullLabel: '116 000 Enfants Disparus', defaultCategorie: 'disparition' },
  { slug: 'alerte_enlevement', label: 'Alerte Enlèvement', fullLabel: 'Alerte Enlèvement (dispositif officiel)', defaultCategorie: 'enlevement' },
  { slug: 'gendarmerie', label: 'Gendarmerie', fullLabel: 'Gendarmerie nationale (appel à témoins)', defaultCategorie: 'disparition_inquietante' },
  { slug: 'police_nationale', label: 'Police nat.', fullLabel: 'Police nationale (appel à témoins)', defaultCategorie: 'disparition_inquietante' },
  { slug: 'presse_locale', label: 'Presse locale', fullLabel: 'Presse locale / France Bleu', defaultCategorie: 'disparition' },
] as const satisfies readonly AlertSourceDef[];

/** Union des slugs connus (type-safe, dérivée du registre). */
export type AlertSource = (typeof ALERT_SOURCE_REGISTRY)[number]['slug'];

/** Liste des slugs (ordre du registre). */
export const ALERT_SOURCE_SLUGS: readonly AlertSource[] = ALERT_SOURCE_REGISTRY.map((s) => s.slug);

const BY_SLUG = new Map<string, AlertSourceDef>(ALERT_SOURCE_REGISTRY.map((s) => [s.slug, s]));

/** Vrai si `slug` est une source connue (garde d'ingest). */
export function isKnownAlertSource(slug: unknown): slug is AlertSource {
  return typeof slug === 'string' && BY_SLUG.has(slug);
}
/** Définition complète d'une source (ou undefined). */
export function alertSourceDef(slug: string): AlertSourceDef | undefined {
  return BY_SLUG.get(slug);
}
/** Libellé court (chips). Repli : le slug brut. */
export function alertSourceLabel(slug: string): string {
  return BY_SLUG.get(slug)?.label ?? slug;
}
/** Libellé complet (fiche carte). Repli : le slug brut. */
export function alertSourceFullLabel(slug: string): string {
  return BY_SLUG.get(slug)?.fullLabel ?? slug;
}
/** Catégorie par défaut de la source (si l'avis n'en porte pas). */
export function alertSourceDefaultCategorie(slug: string): string {
  return BY_SLUG.get(slug)?.defaultCategorie ?? 'disparition';
}

// ─────────────────────────────────────────────────────────────────────────────
//  MÉMO pour chat (parsers n8n) — payload attendu par POST /cockpit/alerts/ingest
//  { source: <slug ci-dessus>, alerts: [ {
//      source_id   (REQUIS, id stable de l'avis chez la source),
//      nom_affiche, age, sexe,
//      categorie   (optionnel — sinon defaultCategorie de la source),
//      url_source, date_publication, photo_url,
//      lieu_texte  (⭐ la localité EN CLAIR — OSIRIS la géocode tout seul,
//                   PAS besoin de géocoder côté n8n ; lat/lon facultatifs)
//  } ] }
// ─────────────────────────────────────────────────────────────────────────────
