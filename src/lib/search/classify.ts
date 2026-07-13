// ─────────────────────────────────────────────────────────────────────────
//  Détection du type de requête + routage des connecteurs.
//  PORTAGE STRICT de open_radar/schema.py::infer_query_type et
//  open_radar/orchestrator.py::classify_query (V3, backend Python).
//  ⚠️ PARITÉ : même entrée → même sortie que le Python. Table de parité :
//     scripts/search-parity-check.mts. Fichier volontairement SANS import
//     (aucun alias `@/…`) pour rester importable tel quel par le script de test.
// ─────────────────────────────────────────────────────────────────────────

/** Miroir de schema.py::infer_query_type. */
export function inferQueryType(query: string): string {
  const compact = query.replace(/\s+/g, '');
  if (/^\d+$/.test(compact) && compact.length === 9) return 'siren';
  if (/^\d+$/.test(compact) && compact.length === 14) return 'siret';
  if (/^\d+$/.test(compact) && compact.length === 5) return 'commune';
  const lowered = query.toLowerCase();
  const words = ['rue', 'avenue', 'boulevard', 'bd', 'chemin', 'place', 'route', 'impasse'];
  if (words.some((w) => lowered.includes(w))) return 'address';
  return 'free_text';
}

// ── Regex miroir de orchestrator.py (mêmes classes, mêmes drapeaux) ──────────
const SIREN_RE = /^\d{9}$/;
const SIRET_RE = /^\d{14}$/;
export const POSTCODE_RE = /\b\d{5}\b/;
const ADDRESS_HINT_RE =
  /\b(rue|avenue|av|boulevard|bd|chemin|place|route|rte|impasse|imp|all[ée]e|quai|cours|square|passage|faubourg|fbg|esplanade|promenade|villa|cit[ée]|hameau|lieu[- ]?dit|sentier|venelle|traverse|mont[ée]e|descente|quartier|r[ée]sidence|lotissement|voie|rond[- ]?point|parvis|mail|clos|domaine|esp|zone|z\.?a|z\.?i|zac)\b/i;
const HOUSE_NUMBER_RE = /^\s*\d{1,4}(?:\s*(?:bis|ter|quater))?\s+\S/;
const RNA_RE = /^W\d{9}$/i;
const ASSO_HINT_RE = /\b(asso(ciation)?|club|comité|comite|amicale|ligue)\b/i;
const FONCIER_HINT_RE = /\b(immobilier|immo|foncier|fonci[eè]re|prix\s+immo|terrain|appartement|maison|dvf)\b/i;

/** Routes de connecteurs à interroger. Miroir de orchestrator.py::classify_query. */
export type Route = 'entreprises' | 'rna' | 'bodacc' | 'adresse' | 'geo' | 'foncier' | 'datagouv';

export function classifyQuery(query: string): Route[] {
  const q = query.trim();
  const compact = q.replace(/\s+/g, '');
  if (RNA_RE.test(compact) || ASSO_HINT_RE.test(q)) return ['rna', 'entreprises', 'geo', 'datagouv'];
  if (SIREN_RE.test(compact) || SIRET_RE.test(compact)) return ['entreprises', 'bodacc'];
  if (ADDRESS_HINT_RE.test(q) || (HOUSE_NUMBER_RE.test(q) && POSTCODE_RE.test(q)))
    return ['adresse', 'entreprises', 'geo', 'datagouv'];
  if (FONCIER_HINT_RE.test(q) && POSTCODE_RE.test(q)) return ['entreprises', 'geo', 'foncier', 'datagouv'];
  if (POSTCODE_RE.test(q)) return ['entreprises', 'geo', 'datagouv'];
  return ['entreprises', 'geo', 'datagouv'];
}
