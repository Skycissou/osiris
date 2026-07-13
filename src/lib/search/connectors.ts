// ─────────────────────────────────────────────────────────────────────────
//  Connecteurs API publiques FR — PORTAGE de open_radar/connectors.py.
//  Phase 1 (moteur V4) : entreprises · adresse (BAN/IGN) · communes · data.gouv.
//  (BODACC/DVF/RNA = Phase 2.) Chaque connecteur gère ses erreurs (carte `error`)
//  → un échec ne fait pas tomber les autres. Appels SERVEUR uniquement.
// ─────────────────────────────────────────────────────────────────────────

import { buildUrl, getJson } from './http';
import { buildFilterParams } from './filters';
import { card, type Card } from './schema';

const utcNow = () => new Date().toISOString();

function errorCard(sourceId: string, sourceLabel: string, url: string, err: unknown): Card {
  return card({
    source_id: sourceId, source_label: sourceLabel, access_level: 'open', confidence: 'official',
    status: 'error', title: `Erreur ${sourceLabel}`, summary: err instanceof Error ? err.message : String(err),
    raw_ref: { url, fetched_at: utcNow() }, limits: ['Erreur réseau/API : résultat non conclusif.'],
  });
}

const ETAT_LABELS: Record<string, string> = { A: 'En activité', C: 'Cessée', F: 'Fermée' };

const EFFECTIF_LABELS: Record<string, string> = {
  '00': '0 salarié', '01': '1 à 2 salariés', '02': '3 à 5 salariés', '03': '6 à 9 salariés',
  '11': '10 à 19 salariés', '12': '20 à 49 salariés', '21': '50 à 99 salariés', '22': '100 à 199 salariés',
  '31': '200 à 249 salariés', '32': '250 à 499 salariés', '41': '500 à 999 salariés', '42': '1000 à 1999 salariés',
  '51': '2000 à 4999 salariés', '52': '5000 à 9999 salariés', '53': '10000 salariés et plus',
};

const LABELS_MAP: Record<string, string> = {
  est_rge: 'RGE', est_bio: 'Bio', est_ess: 'ESS', est_societe_mission: 'Société à mission',
  est_qualiopi: 'Qualiopi', est_organisme_formation: 'Organisme de formation', est_finess: 'FINESS (santé/social)',
  est_service_public: 'Service public', est_association: 'Association', est_entrepreneur_individuel: 'Entrepreneur individuel',
};

type Row = Record<string, unknown>;
const asRow = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function dirigeantsLabel(dirigeants: unknown[]): string {
  const noms: string[] = [];
  for (const raw of dirigeants.slice(0, 3)) {
    const d = asRow(raw);
    if (!raw || typeof raw !== 'object') continue;
    let nom: string;
    if (d.type_dirigeant === 'personne morale' || d.denomination) {
      nom = String(d.denomination || 'Personne morale');
    } else {
      const prenom = titleCase(String(d.prenoms || '').split(' ')[0]);
      const nomFam = titleCase(String(d.nom || ''));
      nom = `${prenom} ${nomFam}`.trim() || 'Dirigeant';
    }
    const qualite = d.qualite;
    noms.push(qualite ? `${nom} (${qualite})` : nom);
  }
  return noms.join(', ');
}

function fmtEuros(value: unknown): string | null {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString('fr-FR').replace(/ /g, ' ') + ' €';
}

function financesLabel(finances: unknown): string {
  const f = asRow(finances);
  const keys = Object.keys(f);
  if (keys.length === 0) return '';
  const year = keys.sort().at(-1)!;
  const data = asRow(f[year]);
  const parts: string[] = [];
  const ca = fmtEuros(data.ca);
  const rnet = fmtEuros(data.resultat_net);
  if (ca) parts.push(`CA ${ca}`);
  if (rnet) parts.push(`résultat net ${rnet}`);
  return parts.length ? `${year} : ${parts.join(' · ')}` : '';
}

function labelsLabel(complements: unknown): string {
  const c = asRow(complements);
  if (!complements || typeof complements !== 'object') return '';
  const actifs = Object.entries(LABELS_MAP).filter(([cle]) => c[cle]).map(([, lib]) => lib);
  if (c.egapro_renseignee) actifs.push('Index Egapro publié');
  if (c.convention_collective_renseignee) actifs.push('Convention collective');
  return actifs.join(' · ');
}

function etablissementsLabel(row: Row): string {
  const nb = row.nombre_etablissements as number | undefined;
  const nbOuverts = row.nombre_etablissements_ouverts as number | undefined;
  const matching = asArr(row.matching_etablissements);
  const villes: string[] = [];
  for (const e of matching.slice(0, 3)) {
    const er = asRow(e);
    const v = er.libelle_commune || er.commune;
    if (v && !villes.includes(String(v))) villes.push(String(v));
  }
  let base = '';
  if (nbOuverts != null && nb != null) base = `${nbOuverts}/${nb} établissement(s) actif(s)`;
  else if (nb != null) base = `${nb} établissement(s)`;
  if (villes.length) base = (base ? base + ' — ' : '') + villes.join(', ');
  return base;
}

function entrepriseCard(row: Row, url: string): Card {
  const siren = String(row.siren || '');
  const nom = row.nom_complet || row.nom_raison_sociale || row.nom_entreprise || 'Entreprise';
  const naf = row.activite_principale || row.section_activite_principale || 'non précisée';
  const etat = ETAT_LABELS[String(row.etat_administratif || '')] || 'statut non précisé';
  const categorie = row.categorie_entreprise;
  const dateCreation = row.date_creation;
  const effectif = EFFECTIF_LABELS[String(row.tranche_effectif_salarie || '')];

  const siege = asRow(row.siege);
  const adresse = String(siege.adresse || '');
  const cp = String(siege.code_postal || '');
  const ville = String(siege.libelle_commune || siege.commune || '');
  const adresseComplete = [adresse.trim(), `${cp} ${ville}`.trim()].filter(Boolean).join(' ').trim();

  const dirigeants = asArr(row.dirigeants);
  const dirigeantTxt = dirigeantsLabel(dirigeants);
  const financesTxt = financesLabel(row.finances);
  const labelsTxt = labelsLabel(row.complements);
  const etabTxt = etablissementsLabel(row);

  const facts = [etat, `Activité ${naf}`];
  if (categorie) facts.push(String(categorie));
  if (effectif) facts.push(effectif);
  if (dateCreation) facts.push(`créée le ${dateCreation}`);
  const lignes = [facts.join(' · ')];
  if (adresseComplete) lignes.push(`📍 Siège : ${adresseComplete}`);
  if (etabTxt) lignes.push(`🏬 ${etabTxt}`);
  if (dirigeantTxt) lignes.push(`👤 Dirigeant(s) : ${dirigeantTxt}`);
  if (financesTxt) lignes.push(`💰 ${financesTxt}`);
  if (labelsTxt) lignes.push(`🏷️ ${labelsTxt}`);

  const dirigeantsPivot = dirigeants
    .map(asRow)
    .filter((d) => d.type_dirigeant !== 'personne morale' && d.nom)
    .slice(0, 3)
    .map((d) => ({ nom: d.nom, prenoms: d.prenoms }));

  return card({
    source_id: 'recherche_entreprises', source_label: "API Recherche d’Entreprises",
    access_level: 'open', confidence: 'official', status: 'found',
    title: String(nom), subtitle: siren ? `SIREN ${siren}` : 'SIREN non affiché',
    summary: lignes.join('\n'),
    entities: siren ? [{ type: 'siren', value: siren }] : [],
    raw_ref: { url, fetched_at: utcNow() },
    limits: ['Données issues de registres publics.', 'Masquer les adresses personnelles si personne physique.'],
    actions: ['open_detail', 'search_bodacc', 'export_report'],
    raw_preview: {
      siren, nom_complet: row.nom_complet, etat_administratif: row.etat_administratif,
      activite_principale: row.activite_principale,
      dirigeants_pivot: dirigeantsPivot,
      adresse_pivot: adresseComplete, postcode_pivot: cp ? String(cp) : '',
    },
  });
}

function attachPagination(cards: Card[], payload: Row, page: number, perPage: number): void {
  const total = payload.total_results;
  if (total == null) return;
  for (const c of cards) {
    c.raw_preview.total_results = total;
    c.raw_preview.page = payload.page ?? page;
    c.raw_preview.per_page = payload.per_page ?? perPage;
  }
}

export async function searchEntreprises(
  query: string,
  { perPage = 10, filters, page = 1 }: { perPage?: number; filters?: Record<string, unknown> | null; page?: number } = {},
): Promise<Card[]> {
  const params: Record<string, string | number> = { q: query, per_page: perPage };
  if (page > 1) params.page = page;
  Object.assign(params, buildFilterParams(filters));
  const url = buildUrl('https://recherche-entreprises.api.gouv.fr/search', params);
  try {
    const payload = asRow(await getJson(url, 'entreprises'));
    const rows = asArr(payload.results);
    if (rows.length === 0) {
      return [card({
        source_id: 'recherche_entreprises', source_label: "API Recherche d’Entreprises",
        access_level: 'open', confidence: 'official', status: 'not_found',
        title: 'Aucune entreprise trouvée', raw_ref: { url, fetched_at: utcNow() },
        limits: ['Absence de résultat sur cette API ≠ absence légale certaine.'],
      })];
    }
    const cards = rows.slice(0, perPage).map((r) => entrepriseCard(asRow(r), url));
    attachPagination(cards, payload, page, perPage);
    return cards;
  } catch (err) {
    return [errorCard('recherche_entreprises', "API Recherche d’Entreprises", url, err)];
  }
}

export async function searchPersonne(nom: string, prenoms = '', perPage = 10): Promise<Card[]> {
  // Recherche les entreprises où une personne est dirigeant (registre public).
  nom = (nom || '').trim();
  if (!nom) {
    return [card({
      source_id: 'recherche_entreprises', source_label: "API Recherche d’Entreprises",
      access_level: 'open', confidence: 'official', status: 'blocked',
      title: 'Nom requis', summary: 'Indiquer au moins un nom de famille pour la recherche par personne.',
      limits: ['La recherche par personne porte sur les dirigeants diffusés du registre public.'],
    })];
  }
  const params: Record<string, string | number> = { nom_personne: nom, per_page: perPage };
  if (prenoms.trim()) params.prenoms_personne = prenoms.trim();
  const url = buildUrl('https://recherche-entreprises.api.gouv.fr/search', params);
  try {
    const payload = asRow(await getJson(url, 'entreprises'));
    const rows = asArr(payload.results);
    if (rows.length === 0) {
      return [card({
        source_id: 'recherche_entreprises', source_label: "API Recherche d’Entreprises",
        access_level: 'open', confidence: 'official', status: 'not_found',
        title: 'Aucune société trouvée pour cette personne', subtitle: `${prenoms} ${nom}`.trim(),
        raw_ref: { url, fetched_at: utcNow() },
        limits: ['Absence de mandat diffusé ≠ absence certaine de mandat (dirigeants non diffusés possibles).'],
      })];
    }
    const cards = rows.slice(0, perPage).map((r) => entrepriseCard(asRow(r), url));
    attachPagination(cards, payload, 1, perPage);
    return cards;
  } catch (err) {
    return [errorCard('recherche_entreprises', "API Recherche d’Entreprises", url, err)];
  }
}

export async function searchAdresse(query: string, limit = 5): Promise<Card[]> {
  // Géoplateforme IGN (même moteur BAN, GeoJSON) — l'ancien api-adresse.data.gouv est déprécié (14/04/2026).
  const url = buildUrl('https://data.geopf.fr/geocodage/search/', { q: query, limit, index: 'address' });
  try {
    const payload = asRow(await getJson(url, 'adresse'));
    const features = asArr(payload.features);
    if (features.length === 0) {
      return [card({
        source_id: 'adresse', source_label: 'API Adresse / BAN', access_level: 'open', confidence: 'official',
        status: 'not_found', title: 'Aucune adresse trouvée', raw_ref: { url, fetched_at: utcNow() },
        limits: ['Géocodage approximatif selon saisie et qualité BAN.'],
      })];
    }
    return features.slice(0, limit).map((f) => {
      const feat = asRow(f);
      const props = asRow(feat.properties);
      const coords = asArr(asRow(feat.geometry).coordinates);
      const lon = coords[0] as number | undefined;
      const lat = coords[1] as number | undefined;
      return card({
        source_id: 'adresse', source_label: 'API Adresse / BAN', access_level: 'open', confidence: 'official',
        status: 'found', title: String(props.label ?? 'Adresse'), subtitle: `score ${props.score ?? 'n/a'}`,
        summary: `Commune : ${props.city ?? 'n/a'} — type : ${props.type ?? 'n/a'}`,
        entities: lat && lon ? [{ type: 'coordinates', value: `${lat},${lon}` }] : [],
        raw_ref: { url, fetched_at: utcNow() },
        limits: ['Score de géocodage à interpréter ; vérifier les doublons/homonymes.'],
        actions: ['open_map', 'export_report'],
        raw_preview: { citycode: props.citycode, postcode: props.postcode, type: props.type },
      });
    });
  } catch (err) {
    return [errorCard('adresse', 'API Adresse / BAN', url, err)];
  }
}

export async function searchCommunes(query: string, limit = 5): Promise<Card[]> {
  const params: Record<string, string> = { fields: 'nom,code,codeDepartement,codeRegion,population,codesPostaux', format: 'json' };
  const q = query.trim();
  if (/^\d+$/.test(q) && q.length === 5) params.codePostal = q;
  else params.nom = q;
  const url = buildUrl('https://geo.api.gouv.fr/communes', params);
  try {
    const payload = await getJson(url, 'geo');
    const rows = asArr(payload);
    if (rows.length === 0) {
      return [card({
        source_id: 'geo_communes', source_label: 'API Geo', access_level: 'open', confidence: 'official',
        status: 'not_found', title: 'Aucune commune trouvée', raw_ref: { url, fetched_at: utcNow() },
        limits: ['Recherche par nom parfois stricte ; essayer code postal ou code INSEE.'],
      })];
    }
    return rows.slice(0, limit).map((raw) => {
      const row = asRow(raw);
      return card({
        source_id: 'geo_communes', source_label: 'API Geo', access_level: 'open', confidence: 'official',
        status: 'found', title: String(row.nom ?? 'Commune'), subtitle: `INSEE ${row.code ?? 'n/a'}`,
        summary: `Département ${row.codeDepartement ?? 'n/a'}, région ${row.codeRegion ?? 'n/a'}, population ${row.population ?? 'n/a'}.`,
        entities: [{ type: 'code_insee', value: String(row.code) }],
        raw_ref: { url, fetched_at: utcNow() },
        limits: ['Données administratives agrégées, pas nominatives.'],
        actions: ['search_datasets', 'open_map', 'export_report'],
        raw_preview: { codesPostaux: row.codesPostaux ?? [] },
      });
    });
  } catch (err) {
    return [errorCard('geo_communes', 'API Geo', url, err)];
  }
}

export async function searchDatagouv(query: string, pageSize = 5): Promise<Card[]> {
  const url = buildUrl('https://www.data.gouv.fr/api/1/datasets/', { q: query, page_size: pageSize });
  try {
    const payload = asRow(await getJson(url, 'datagouv'));
    const rows = asArr(payload.data);
    if (rows.length === 0) {
      return [card({
        source_id: 'data_gouv', source_label: 'data.gouv catalogue', access_level: 'open', confidence: 'official',
        status: 'not_found', title: 'Aucun dataset trouvé', raw_ref: { url, fetched_at: utcNow() },
        limits: ['Catalogue non exhaustif de toutes les données locales.'],
      })];
    }
    return rows.slice(0, pageSize).map((raw) => {
      const row = asRow(raw);
      const orgObj = asRow(row.organization);
      const org = row.organization && typeof row.organization === 'object' ? orgObj.name : 'producteur inconnu';
      return card({
        source_id: 'data_gouv', source_label: 'data.gouv catalogue', access_level: 'open', confidence: 'official',
        status: 'found', title: String(row.title ?? 'Dataset'), subtitle: String(org || 'producteur inconnu'),
        summary: String(row.description ?? '').replace(/\n/g, ' ').slice(0, 220),
        raw_ref: { url, fetched_at: utcNow() },
        limits: ['Vérifier licence, fraîcheur et formats avant réutilisation.'],
        actions: ['open_dataset', 'preview_resources', 'export_report'],
        raw_preview: { id: row.id, license: row.license, resources: asArr(row.resources).length },
      });
    });
  } catch (err) {
    return [errorCard('data_gouv', 'data.gouv catalogue', url, err)];
  }
}
