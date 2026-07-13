// ─────────────────────────────────────────────────────────────────────────
//  Parseur du listing ARPD (arpd.fr/fr/recherche-disparition) — Drupal Views grille.
//  Structure vérifiée sur capture RÉELLE (13/07) : chaque avis = un `views-col`
//  avec 5 champs (title-1 → <a href>+titre · imagealaune3 → <img> · region ·
//  departement-france · etiquette-disparition → SOURCE). Fixture golden :
//  __fixtures__/listing-sample.html — test rouge = refonte du site → signal STATE.
//
//  ⚠️ Champs FIABLES = taxo Drupal (source/région/dépt-nom) + href + img.
//     Champs du TITRE (saisie bénévole, formats libres) = best-effort, JAMAIS de
//     perte : parsing partiel → l'avis est GARDÉ (titreBrut + taxo).
//  Pur, sans import : importable tel quel par le script de test Node.
// ─────────────────────────────────────────────────────────────────────────

export const ARPD_BASE = 'https://www.arpd.fr';

export type ArpdSource = 'ARPD' | 'Gendarmerie' | 'Police' | '116000';

export interface ArpdAvisParsed {
  id: string;                 // slug de l'URL = ID stable
  url: string;                // lien avis original (attribution, règle 2)
  titreBrut: string;          // TOUJOURS conservé (fallback)
  source: ArpdSource | string;
  deptNom: string | null;     // taxo Drupal (FIABLE)
  region: string | null;      // taxo Drupal (FIABLE)
  photoUrl: string | null;    // hotlink arpd.fr — jamais de copie locale (RGPD)
  nom: string | null;
  age: number | null;
  dateDisparition: string | null;  // ISO complète OU partielle ("2021")
  ville: string | null;
  deptCode: string | null;    // "77", "2B", … (depuis le titre)
}

const MONTHS: Record<string, string> = {
  janvier: '01', février: '02', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06',
  juillet: '07', août: '08', aout: '08', septembre: '09', octobre: '10', novembre: '11', décembre: '12', decembre: '12',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#0*39;|&rsquo;/g, "'")
    .replace(/&#0*34;|&quot;/g, '"')
    .replace(/&#0*38;|&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, ' ')      // sécurité : purge d'éventuelles balises résiduelles
    .replace(/\s+/g, ' ')
    .trim();
}

function fieldText(chunk: string, field: string): string | null {
  const m = chunk.match(new RegExp(`views-field-field-${field}"><span class="field-content">([\\s\\S]*?)</span>`));
  const t = m ? decodeEntities(m[1]) : '';
  return t || null;
}

function normalizeSource(raw: string | null): ArpdSource | string {
  const s = (raw || '').trim();
  if (/^116\s?000$/.test(s)) return '116000';
  if (/^ARPD$/i.test(s)) return 'ARPD';
  if (/^Gendarmerie$/i.test(s)) return 'Gendarmerie';
  if (/^Police$/i.test(s)) return 'Police';
  return s || 'ARPD'; // repli : source inconnue → ARPD (source du site)
}

function parseAge(titre: string): number | null {
  const m = titre.match(/(\d{1,3})\s*ans/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseDeptCode(titre: string): string | null {
  const all = [...titre.matchAll(/\((\d{2,3}|2[AB])\)/gi)];
  return all.length ? all[all.length - 1][1].toUpperCase() : null;
}

function parseDate(titre: string): string | null {
  // 1) jj/mm/aaaa
  const dmy = titre.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  // 2) « JJ <mois-fr> AAAA »
  const named = titre.match(/\b(\d{1,2})\s+([a-zà-ÿ]+)\s+((?:19|20)\d{2})\b/i);
  if (named && MONTHS[named[2].toLowerCase()]) {
    return `${named[3]}-${MONTHS[named[2].toLowerCase()]}-${named[1].padStart(2, '0')}`;
  }
  // 3) repli : année seule (partielle) — on privilégie 19xx/20xx (évite les nombres parasites)
  const year = titre.match(/\b(19|20)\d{2}\b/);
  return year ? year[0] : null;
}

function parseVille(titre: string): string | null {
  // Ville = juste avant la parenthèse du département. Anchor sur une MAJUSCULE
  // (nom de lieu) → évite « a disparu », « a été vu »… On prend le DERNIER match.
  const all = [...titre.matchAll(/(?:à|a)\s+([A-ZÀ-Ÿ][^,(–\-]*?)\s*\(/g)];
  if (!all.length) return null;
  const v = all[all.length - 1][1].trim();
  return v || null;
}

function parseNom(titre: string): string | null {
  const comma = titre.indexOf(',');
  const ansM = titre.match(/\d{1,3}\s*ans/);
  const ansIdx = ansM ? titre.indexOf(ansM[0]) : -1;
  let nom = titre;
  if (comma >= 0 && (ansIdx < 0 || comma < ansIdx)) nom = titre.slice(0, comma);
  else if (ansIdx >= 0) nom = titre.slice(0, ansIdx);
  nom = nom.trim();
  return nom || null;
}

/**
 * Photo depuis une PAGE DÉTAIL d'avis (repli pour les avis « legacy » dont le
 * listing n'a pas de miniature média : leur carte a le champ image VIDE, mais la
 * page détail porte la vraie photo sous `/uploaded/<slug>.jpg`). On prend la
 * version PLEINE (sans préfixe `mini-`), sinon la 1re miniature. Le logo ARPD et
 * l'image « accès membre » vivent sous `/sites/default/files/` → jamais captés
 * ici (on ne matche QUE `/uploaded/`). Renvoie une URL absolue ou null.
 */
export function parseDetailPhoto(html: string): string | null {
  const all = [...html.matchAll(/<img[^>]+src="(\/uploaded\/[^"]+\.(?:jpe?g|png))"/gi)].map((m) => m[1]);
  if (!all.length) return null;
  const full = all.find((u) => !/\/uploaded\/mini-/i.test(u));
  return ARPD_BASE + (full || all[0]);
}

/** Parse une page de listing → avis bruts (SANS géocodage, ajouté au sync). */
export function parseListing(html: string): ArpdAvisParsed[] {
  const out: ArpdAvisParsed[] = [];
  const chunks = html.split(/<div class="views-col col-\d+"/).slice(1);
  for (const chunk of chunks) {
    const titleM = chunk.match(/views-field-title-1"><span class="field-content"><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleM) continue;
    const href = titleM[1];
    const titreBrut = decodeEntities(titleM[2]);
    const id = href.replace(/^\/(fr\/)?/, '');
    const url = ARPD_BASE + (href.startsWith('/') ? href : `/${href}`);

    // Photo (optionnelle) — cherchée UNIQUEMENT dans le bloc image, avant la région.
    const imgZone = chunk.split('views-field-field-region')[0];
    const imgM = imgZone.match(/views-field-field-imagealaune3[\s\S]*?<img[^>]+src="([^"]+)"/);
    const photoUrl = imgM ? ARPD_BASE + imgM[1] : null;

    out.push({
      id, url, titreBrut,
      source: normalizeSource(fieldText(chunk, 'etiquette-disparition')),
      deptNom: fieldText(chunk, 'departement-france'),
      region: fieldText(chunk, 'region'),
      photoUrl,
      nom: parseNom(titreBrut),
      age: parseAge(titreBrut),
      dateDisparition: parseDate(titreBrut),
      ville: parseVille(titreBrut),
      deptCode: parseDeptCode(titreBrut),
    });
  }
  return out;
}
