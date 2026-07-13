// ─────────────────────────────────────────────────────────────────────────
//  Connecteurs Phase 2 — PORTAGE de open_radar : BODACC (connectors.py),
//  DVF/foncier (connectors_dvf.py), RNA/associations (connectors_rna.py).
//  Mêmes règles : erreurs → carte `error`, appels SERVEUR uniquement, parité stricte.
//  ⚠️ DVF = posture territoire (aucune donnée nominative, jamais de profilage).
// ─────────────────────────────────────────────────────────────────────────

import { buildUrl, getJson } from './http';
import { card, type Card } from './schema';

const utcNow = () => new Date().toISOString();
type Row = Record<string, unknown>;
const asRow = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function errorCard(sourceId: string, sourceLabel: string, url: string, err: unknown, extraLimits: string[] = []): Card {
  return card({
    source_id: sourceId, source_label: sourceLabel, access_level: 'open', confidence: 'official',
    status: 'error', title: `Erreur ${sourceLabel}`, summary: err instanceof Error ? err.message : String(err),
    raw_ref: { url, fetched_at: utcNow() }, limits: ['Erreur réseau/API : résultat non conclusif.', ...extraLimits],
  });
}

// ═══════════════════════════ BODACC ═══════════════════════════
const BODACC_DATASET = 'annonces-commerciales';
const BODACC_BASE = 'https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets';
const PROCEDURE_KEYWORDS = ['liquidation', 'redressement', 'sauvegarde', 'procedure', 'procédure', 'jugement'];
const BODACC_LABEL = 'BODACC — annonces civiles et commerciales';

function recordFields(record: Row): Row {
  if (record.fields && typeof record.fields === 'object') return asRow(record.fields);
  if (record.record && typeof record.record === 'object') {
    const f = asRow(record.record).fields;
    if (f && typeof f === 'object') return asRow(f);
  }
  return record;
}

function normalizeBodaccRecord(record: Row, dataset: string, url: string): Card {
  const fields = recordFields(record);
  const registre = fields.registre;
  let registreValue = '';
  if (Array.isArray(registre)) registreValue = registre.map(String).find((s) => s.replace(/ /g, '').match(/^\d+$/)) ?? '';
  else registreValue = String(registre ?? '');
  const siren = String(fields.siren ?? fields.registre_siren ?? registreValue).replace(/ /g, '').trim();
  const commercant = fields.nomcommercant || fields.commercant || fields.denomination || fields.personne || 'Annonce BODACC';
  const typeAvis = fields.typeavis_lib || fields.familleavis_lib || fields.typeavis || 'Annonce légale';
  const date = fields.dateparution || fields.date_publication || fields.date || 'date non précisée';
  const tribunal = fields.tribunal || fields.tribunal_lib || 'tribunal non précisé';
  const blob = [typeAvis, fields.familleavis_lib ?? '', fields.jugement ?? ''].map((v) => String(v).toLowerCase()).join(' ');
  const procedureAlert = dataset === 'bodacc-c' || PROCEDURE_KEYWORDS.some((k) => blob.includes(k));

  return card({
    source_id: 'bodacc', source_label: BODACC_LABEL, access_level: 'open', confidence: 'official', status: 'found',
    title: String(commercant), subtitle: `${typeAvis} — ${date}`, summary: `${typeAvis}. Tribunal : ${tribunal}.`,
    entities: siren ? [{ type: 'siren', value: siren }] : [],
    raw_ref: { url, fetched_at: utcNow() },
    limits: [
      'Annonce publiée légalement ; vérifier le détail sur bodacc.fr pour la version officielle.',
      'Une procédure collective détectée doit être confirmée sur la source officielle à jour.',
    ],
    actions: ['open_bodacc', 'export_report'],
    raw_preview: { dataset, siren, typeavis_lib: typeAvis, dateparution: date, tribunal, alerte_procedure_collective: procedureAlert },
  });
}

export async function searchBodacc(siren: string, limit = 5): Promise<Card[]> {
  const clean = String(siren).replace(/\D/g, '');
  if (![9, 14].includes(clean.length)) {
    return [card({
      source_id: 'bodacc', source_label: BODACC_LABEL, access_level: 'open', confidence: 'official', status: 'blocked',
      title: 'Recherche BODACC réservée aux SIREN/SIRET',
      summary: "Le MVP interroge le BODACC uniquement après identification d'un SIREN/SIRET.",
      limits: ['Entrer un SIREN à 9 chiffres ou un SIRET à 14 chiffres.'],
    })];
  }
  const queryValue = clean.slice(0, 9);
  const where = encodeURIComponent(`registre="${queryValue}"`);
  const url = `${BODACC_BASE}/${BODACC_DATASET}/records?where=${where}&order_by=-dateparution&limit=${limit}`;
  try {
    const payload = asRow(await getJson(url, 'bodacc'));
    const rows = asArr(payload.results);
    const out = rows.slice(0, limit).map((r) => normalizeBodaccRecord(asRow(r), BODACC_DATASET, url));
    if (out.length) return out;
    return [card({
      source_id: 'bodacc', source_label: BODACC_LABEL, access_level: 'open', confidence: 'official', status: 'not_found',
      title: 'Aucune annonce BODACC trouvée', subtitle: `SIREN ${queryValue}`,
      summary: 'Aucune annonce trouvée dans le dataset BODACC annonces-commerciales.',
      entities: [{ type: 'siren', value: queryValue }], raw_ref: { url, fetched_at: utcNow() },
      limits: ["Absence d'annonce BODACC ≠ absence de tout événement légal ou contentieux."], actions: ['export_report'],
    })];
  } catch (err) {
    return [errorCard('bodacc', BODACC_LABEL, url, err)];
  }
}

// ═══════════════════════════ DVF (foncier) ═══════════════════════════
const DVF_SOURCE_ID = 'dvf';
const DVF_LABEL = 'DVF — valeurs foncières';
const DVF_BASE = 'https://api.cquest.org/dvf';
const PRIVACY_LIMITS = [
  'Données publiques de ventes (DGFiP, Licence Ouverte 2.0), à interpréter avec prudence.',
  "Pas de donnée nominative sur l'acheteur/vendeur : DVF n'identifie aucune personne.",
  'Vue territoriale agrégée — ne pas utiliser pour profiler une personne via un bien.',
  'Périmètre DVF : ni Alsace, ni Moselle, ni Mayotte ; fraîcheur variable selon publication DGFiP.',
];

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length, mid = Math.floor(n / 2);
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function fmtEurosF(value: unknown): string | null {
  const n = parseFloat(String(value).replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ') + ' €';
}
function fmtSurface(value: unknown): string | null {
  const n = parseFloat(String(value).replace(',', '.'));
  if (Number.isNaN(n) || n <= 0) return null;
  return `${Math.round(n)} m²`;
}
function recordProps(record: unknown): Row {
  const r = asRow(record);
  const props = r.properties;
  if (props && typeof props === 'object') return asRow(props);
  return r;
}
function dvfAdresse(props: Row): string {
  const numero = String(props.adresse_numero ?? '').trim();
  const suffixe = String(props.adresse_suffixe ?? '').trim();
  const voie = String(props.adresse_nom_voie ?? '').trim();
  const cp = String(props.code_postal ?? '').trim();
  const commune = String(props.nom_commune ?? '').trim();
  const rue = [numero, suffixe, voie].filter(Boolean).join(' ').trim();
  const ville = `${cp} ${commune}`.trim();
  return [rue, ville].filter(Boolean).join(', ');
}
function dvfNormalizeOne(props: Row, url: string): Card {
  const typeLocal = String(props.type_local ?? '').trim() || 'Bien (type non précisé)';
  const nature = String(props.nature_mutation ?? 'Vente').trim();
  const commune = String(props.nom_commune ?? props.code_commune ?? 'commune ?').trim();
  const date = String(props.date_mutation ?? 'date non précisée').trim();
  const valeur = fmtEurosF(props.valeur_fonciere);
  const surfaceBati = fmtSurface(props.surface_reelle_bati);
  const surfaceTerrain = fmtSurface(props.surface_terrain);
  const pieces = props.nombre_pieces_principales;
  const adresse = dvfAdresse(props);

  const lignes: string[] = [valeur ? `💶 Valeur foncière : ${valeur}` : '💶 Valeur foncière : non communiquée'];
  const bienParts: string[] = [];
  if (surfaceBati) bienParts.push(`bâti ${surfaceBati}`);
  if (![null, undefined, '', 0, '0'].includes(pieces as string | number)) bienParts.push(`${pieces} pièce(s)`);
  if (surfaceTerrain) bienParts.push(`terrain ${surfaceTerrain}`);
  if (bienParts.length) lignes.push('🏠 ' + bienParts.join(' · '));
  if (adresse) lignes.push(`📍 ${adresse}`);
  lignes.push(`📄 Nature : ${nature}`);

  return card({
    source_id: DVF_SOURCE_ID, source_label: DVF_LABEL, access_level: 'open', confidence: 'official', status: 'found',
    title: `${typeLocal} — ${commune}`, subtitle: `Mutation du ${date}`, summary: lignes.join('\n'),
    entities: props.code_commune ? [{ type: 'code_insee', value: String(props.code_commune) }] : [],
    raw_ref: { url, fetched_at: utcNow() }, limits: [...PRIVACY_LIMITS], actions: ['open_map', 'export_report'],
    raw_preview: {
      id_mutation: props.id_mutation, date_mutation: props.date_mutation, nature_mutation: props.nature_mutation,
      valeur_fonciere: props.valeur_fonciere, type_local: props.type_local, surface_reelle_bati: props.surface_reelle_bati,
      nombre_pieces_principales: props.nombre_pieces_principales, code_commune: props.code_commune, nom_commune: props.nom_commune,
    },
  });
}
function dvfSynthese(propsList: Row[], url: string, territoire: string): Card {
  const valeurs: number[] = [];
  const prixM2: number[] = [];
  const types = new Map<string, number>();
  for (const props of propsList) {
    let valeur: number | null = null;
    const v = parseFloat(String(props.valeur_fonciere).replace(',', '.'));
    if (!Number.isNaN(v)) { valeur = v; valeurs.push(v); }
    if (valeur !== null) {
      const surf = parseFloat(String(props.surface_reelle_bati).replace(',', '.'));
      if (!Number.isNaN(surf) && surf > 0) prixM2.push(valeur / surf);
    }
    const t = String(props.type_local ?? '').trim();
    if (t) types.set(t, (types.get(t) ?? 0) + 1);
  }
  const lignes = [`📊 Échantillon affiché : ${propsList.length} mutation(s).`];
  if (valeurs.length) lignes.push(`💶 Valeur : ${fmtEurosF(Math.min(...valeurs))} → ${fmtEurosF(Math.max(...valeurs))} (médiane ${fmtEurosF(median(valeurs))})`);
  if (prixM2.length) lignes.push(`📐 Prix au m² (médian) : ${fmtEurosF(median(prixM2))}/m²`);
  if (types.size) {
    const top = [...types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} ×${n}`);
    lignes.push('🏠 Types : ' + top.join(', '));
  }
  return card({
    source_id: DVF_SOURCE_ID, source_label: DVF_LABEL, access_level: 'open', confidence: 'official', status: 'found',
    title: `Synthèse foncière — ${territoire}`, subtitle: 'Agrégat territorial (non nominatif)', summary: lignes.join('\n'),
    raw_ref: { url, fetched_at: utcNow() }, limits: [...PRIVACY_LIMITS], actions: ['export_report'],
    raw_preview: { territoire, echantillon: propsList.length },
  });
}
function normalizeDvfRecords(payload: unknown, url: string, territoire: string, limit = 5): Card[] {
  let records: unknown[] = [];
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = asRow(payload);
    records = Array.isArray(p.features) ? p.features : Array.isArray(p.resultats) ? p.resultats : [];
  } else if (Array.isArray(payload)) records = payload;
  const propsList = records.map(recordProps).filter((p) => Object.keys(p).length > 0);
  if (propsList.length === 0) {
    return [card({
      source_id: DVF_SOURCE_ID, source_label: DVF_LABEL, access_level: 'open', confidence: 'official', status: 'not_found',
      title: 'Aucune mutation foncière trouvée', subtitle: territoire, raw_ref: { url, fetched_at: utcNow() },
      limits: ['Absence de mutation publiée ≠ absence de transaction (périmètre/fraîcheur DVF).', ...PRIVACY_LIMITS],
    })];
  }
  return [dvfSynthese(propsList, url, territoire), ...propsList.slice(0, limit).map((p) => dvfNormalizeOne(p, url))];
}
export async function searchFoncier({ codeCommune = '', codePostal = '', limit = 5 }: { codeCommune?: string; codePostal?: string; limit?: number } = {}): Promise<Card[]> {
  codeCommune = (codeCommune || '').trim();
  codePostal = (codePostal || '').trim();
  if (!codeCommune && !codePostal) {
    return [card({
      source_id: DVF_SOURCE_ID, source_label: DVF_LABEL, access_level: 'open', confidence: 'official', status: 'blocked',
      title: 'Code commune (INSEE) ou code postal requis',
      summary: 'DVF s\'interroge par territoire : fournir un code INSEE ou un code postal.',
      limits: ['DVF est une donnée territoriale, pas une recherche par personne.', ...PRIVACY_LIMITS],
    })];
  }
  const params: Record<string, string> = {};
  let territoire: string;
  if (codeCommune) { params.code_commune = codeCommune; territoire = `commune INSEE ${codeCommune}`; }
  else { params.code_postal = codePostal; territoire = `code postal ${codePostal}`; }
  const url = buildUrl(DVF_BASE, params);
  try {
    return normalizeDvfRecords(await getJson(url, 'foncier'), url, territoire, limit);
  } catch (err) {
    return [errorCard(DVF_SOURCE_ID, DVF_LABEL, url, err, ['Erreur réseau/API DVF : résultat non conclusif (API non garantie, POC).'])];
  }
}

// ═══════════════════════════ RNA (associations) ═══════════════════════════
const RNA_LABEL = 'RNA — associations';
const RNA_BASE = 'https://recherche-entreprises.api.gouv.fr/search';
const NATURE_LABELS: Record<string, string> = {
  'Loi 1901': 'Association loi 1901',
  'Alsace-Moselle': 'Association droit local Alsace-Moselle (hors RNA)',
};
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function rnaDirigeantsLabel(dirigeants: unknown[]): string {
  const noms: string[] = [];
  for (const raw of dirigeants.slice(0, 3)) {
    if (!raw || typeof raw !== 'object') continue;
    const d = asRow(raw);
    let nom: string;
    if (d.denomination) nom = String(d.denomination);
    else {
      const prenom = titleCase(String(d.prenoms || '').split(' ')[0]);
      const nomFam = titleCase(String(d.nom || ''));
      nom = `${prenom} ${nomFam}`.trim() || 'Responsable';
    }
    const qualite = d.qualite;
    noms.push(qualite ? `${nom} (${qualite})` : nom);
  }
  return noms.join(', ');
}

function normalizeAssociation(row: Row, url: string): Card {
  const rna = String(row.identifiant_association ?? '').trim();
  const siren = String(row.siren ?? '').trim();
  const nom = row.nom_complet || row.nom_raison_sociale || row.nom_entreprise || 'Association';
  const complements = asRow(row.complements);
  const nature = row.nature_juridique || '';
  const natureTxt = NATURE_LABELS[String(nature)] ?? (nature ? String(nature) : '');
  const objet = String(row.objet || row.activite_principale_libelle || '').trim();
  const dateCreation = row.date_creation;
  const siege = asRow(row.siege);
  const cp = siege.code_postal || '';
  const ville = siege.libelle_commune || siege.commune || '';
  const localite = `${cp} ${ville}`.trim();
  const dirigeants = asArr(row.dirigeants);
  const dirigeantTxt = rnaDirigeantsLabel(dirigeants);

  let subtitle: string;
  if (rna) subtitle = `RNA ${rna}`;
  else if (siren) subtitle = `SIREN ${siren} (RNA non diffusé)`;
  else subtitle = 'Identifiant RNA/SIREN non affiché';

  const facts: string[] = [];
  if (natureTxt) facts.push(natureTxt);
  if (dateCreation) facts.push(`créée le ${dateCreation}`);
  const lignes: string[] = [];
  if (facts.length) lignes.push(facts.join(' · '));
  if (objet) lignes.push(`🎯 Objet : ${objet.slice(0, 220)}`);
  if (localite) lignes.push(`📍 Siège : ${localite}`);
  if (dirigeantTxt) lignes.push(`👤 Responsable(s) : ${dirigeantTxt}`);
  const summary = lignes.length ? lignes.join('\n') : 'Association référencée.';

  const entities: Array<{ type: string; value: string }> = [];
  if (rna) entities.push({ type: 'rna', value: rna });
  if (siren) entities.push({ type: 'siren', value: siren });

  return card({
    source_id: 'rna', source_label: RNA_LABEL, access_level: 'open', confidence: 'official', status: 'found',
    title: String(nom), subtitle, summary, entities, raw_ref: { url, fetched_at: utcNow() },
    limits: [
      "Données publiques associations (RNA) via l'API Recherche d'Entreprises.",
      'Les associations Alsace-Moselle ne sont pas au RNA (champ identifiant_association vide).',
      'Vérifier la fraîcheur sur le journal officiel des associations pour les dissolutions/modifs.',
    ],
    actions: ['open_detail', 'search_bodacc', 'export_report'],
    raw_preview: {
      identifiant_association: rna, siren, nom_complet: row.nom_complet, nature_juridique: nature,
      est_association: complements.est_association, date_creation: dateCreation,
      postcode_pivot: cp ? String(cp) : '',
      dirigeants_pivot: dirigeants.map(asRow).filter((d) => d.nom).slice(0, 3).map((d) => ({ nom: d.nom, prenoms: d.prenoms })),
    },
  });
}

export async function searchAssociations(query: string, perPage = 5): Promise<Card[]> {
  query = (query || '').trim();
  if (!query) {
    return [card({
      source_id: 'rna', source_label: RNA_LABEL, access_level: 'open', confidence: 'official', status: 'blocked',
      title: 'Requête vide', summary: "Indiquer un nom d'association, une ville ou un identifiant RNA (W…).",
      limits: ['Données publiques associations (RNA).'],
    })];
  }
  const url = buildUrl(RNA_BASE, { q: query, est_association: 'true', per_page: perPage });
  try {
    const payload = asRow(await getJson(url, 'entreprises')); // même amont que entreprises → circuit partagé
    const rows = asArr(payload.results);
    if (rows.length === 0) {
      return [card({
        source_id: 'rna', source_label: RNA_LABEL, access_level: 'open', confidence: 'official', status: 'not_found',
        title: 'Aucune association trouvée', subtitle: query, raw_ref: { url, fetched_at: utcNow() },
        limits: [
          'Absence de résultat ≠ absence légale certaine.',
          "Les associations Alsace-Moselle ne sont pas au RNA (pas d'identifiant W).",
          'Données publiques associations (RNA).',
        ],
      })];
    }
    return rows.slice(0, perPage).map((r) => normalizeAssociation(asRow(r), url));
  } catch (err) {
    return [errorCard('rna', RNA_LABEL, url, err, ['Données publiques associations (RNA).'])];
  }
}
