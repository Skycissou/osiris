// ─────────────────────────────────────────────────────────────────────────
//  Filtres ciblés → paramètres de l'API Recherche d'Entreprises.
//  PORTAGE de open_radar/filters.py (mode NON-strict, celui utilisé par les
//  connecteurs). AUCUN appel réseau : transforme un dict de filtres « propres »
//  en paramètres de requête publics. Noms de params EXACTS (vérifiés 2026-06-23).
// ─────────────────────────────────────────────────────────────────────────

// Clé interne lisible → nom du paramètre PUBLIC de l'API /search.
const FILTER_PARAM_MAP: Record<string, string> = {
  code_postal: 'code_postal',
  departement: 'departement',
  code_commune: 'code_commune',
  region: 'region',
  epci: 'epci',
  naf: 'activite_principale',
  section_naf: 'section_activite_principale',
  categorie: 'categorie_entreprise',
  nature_juridique: 'nature_juridique',
  effectif: 'tranche_effectif_salarie',
  etat: 'etat_administratif',
};

// Filtres booléens (labels / certifications) → valeur API "true".
const BOOLEAN_FILTER_PARAM_MAP: Record<string, string> = {
  rge: 'est_rge',
  bio: 'est_bio',
  ess: 'est_ess',
  societe_mission: 'est_societe_mission',
  qualiopi: 'est_qualiopi',
  organisme_formation: 'est_organisme_formation',
  association: 'est_association',
  entrepreneur_individuel: 'est_entrepreneur_individuel',
  finess: 'est_finess',
  collectivite_territoriale: 'est_collectivite_territoriale',
  administration: 'est_administration',
  siae: 'est_siae',
  entrepreneur_spectacle: 'est_entrepreneur_spectacle',
  patrimoine_vivant: 'est_patrimoine_vivant',
  convention_collective: 'convention_collective_renseignee',
  egapro: 'egapro_renseignee',
};

const LIST_PARAMS = new Set([
  'code_postal', 'departement', 'code_commune', 'region', 'epci',
  'activite_principale', 'section_activite_principale',
  'categorie_entreprise', 'nature_juridique', 'tranche_effectif_salarie',
]);

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['1', 'true', 'vrai', 'oui', 'on', 'yes'].includes(v.trim().toLowerCase());
  return !!v;
}

function normScalar(v: unknown): string {
  return String(v).trim();
}

function normList(v: unknown): string {
  const parts = Array.isArray(v) ? v.map(normScalar) : String(v).split(',').map((p) => p.trim());
  const seen: string[] = [];
  for (const p of parts) if (p && !seen.includes(p)) seen.push(p);
  return seen.join(',');
}

/** Miroir de filters.py::build_filter_params (mode non-strict). */
export function buildFilterParams(filters?: Record<string, unknown> | null): Record<string, string> {
  if (!filters) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(filters)) {
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue;
    if (key in FILTER_PARAM_MAP) {
      const param = FILTER_PARAM_MAP[key];
      const value = LIST_PARAMS.has(param) ? normList(raw) : normScalar(raw);
      if (!value) continue;
      out[param] = value;
      continue;
    }
    if (key in BOOLEAN_FILTER_PARAM_MAP) {
      if (truthy(raw)) out[BOOLEAN_FILTER_PARAM_MAP[key]] = 'true';
      continue;
    }
    // clé inconnue (ex. 'page') → ignorée silencieusement (non-strict).
  }
  return out;
}
