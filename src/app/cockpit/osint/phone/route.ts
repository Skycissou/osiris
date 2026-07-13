// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS V4 — OSINT / PHONE : parsing & validation LÉGÈRE d'un numéro.
//
//  SOURCE : AUCUNE (traitement 100 % LOCAL, aucun appel réseau, aucune clé).
//  On détecte l'indicatif pays depuis le préfixe international « + », on
//  normalise en E.164 approximatif (chiffres uniquement) et on renvoie une
//  validité BASIQUE (longueur plausible). Cette route ne CONTACTE personne :
//  elle est donc immédiate et gratuite.
//
//  ⚠️ LIMITE ASSUMÉE : ceci n'est PAS une validation opérateur. Confirmer qu'un
//  numéro est ATTRIBUÉ / ACTIF / porté sur tel réseau exigerait une API à clé
//  (ex. NUMVERIFY_KEY chez numverify/apilayer, Twilio Lookup…). Option future :
//  brancher NUMVERIFY_KEY et déléguer la validation « réelle » à cet amont.
//  Le mapping d'indicatifs ci-dessous est volontairement PARTIEL (principaux
//  pays + zone francophone/UE), extensible en ajoutant une entrée.
//
//  CONTRAT (client) :
//    GET /osint/phone?q=<numéro>
//    → 200 { input, e164?, country?, valid }
//        • input  : la saisie brute (echo)
//        • e164   : forme normalisée « +<chiffres> » si un « + » exploitable
//        • country: nom du pays détecté depuis l'indicatif, si reconnu
//        • valid  : heuristique locale (indicatif connu + longueur plausible)
//    Jamais de 500 (entrée invalide → { valid:false }).
//
//  CADRE ARPD : simple normalisation d'une donnée saisie par l'enquêteur,
//  aucun appel externe, aucun profilage.
//
//  Ré-écriture clean-room (calque : src/app/live-feed/fast/route.ts).
//  Clé env : AUCUNE (NUMVERIFY_KEY = piste future documentée, non utilisée ici).
// ─────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';

// Pas de réseau, mais on garde force-dynamic pour lire proprement la query.
export const dynamic = 'force-dynamic';

const MAX_Q_LEN = 40;

/**
 * Mapping PARTIEL indicatif → { pays, longueur nationale attendue [min,max] }.
 * Les longueurs sont indicatives (chiffres APRÈS l'indicatif) et servent juste
 * à l'heuristique `valid`. Trié pour un matching « préfixe le plus long ».
 * Extensible : ajouter une ligne suffit.
 */
const DIAL_CODES: Array<{ code: string; country: string; nsnMin: number; nsnMax: number }> = [
  { code: '1', country: 'États-Unis / Canada', nsnMin: 10, nsnMax: 10 },
  { code: '33', country: 'France', nsnMin: 9, nsnMax: 9 },
  { code: '32', country: 'Belgique', nsnMin: 8, nsnMax: 9 },
  { code: '41', country: 'Suisse', nsnMin: 9, nsnMax: 9 },
  { code: '49', country: 'Allemagne', nsnMin: 6, nsnMax: 11 },
  { code: '44', country: 'Royaume-Uni', nsnMin: 9, nsnMax: 10 },
  { code: '34', country: 'Espagne', nsnMin: 9, nsnMax: 9 },
  { code: '39', country: 'Italie', nsnMin: 9, nsnMax: 11 },
  { code: '351', country: 'Portugal', nsnMin: 9, nsnMax: 9 },
  { code: '352', country: 'Luxembourg', nsnMin: 8, nsnMax: 9 },
  { code: '212', country: 'Maroc', nsnMin: 9, nsnMax: 9 },
  { code: '213', country: 'Algérie', nsnMin: 9, nsnMax: 9 },
  { code: '216', country: 'Tunisie', nsnMin: 8, nsnMax: 8 },
  { code: '221', country: 'Sénégal', nsnMin: 9, nsnMax: 9 },
  { code: '225', country: "Côte d'Ivoire", nsnMin: 8, nsnMax: 10 },
  { code: '7', country: 'Russie / Kazakhstan', nsnMin: 10, nsnMax: 10 },
  { code: '86', country: 'Chine', nsnMin: 11, nsnMax: 11 },
  { code: '91', country: 'Inde', nsnMin: 10, nsnMax: 10 },
  { code: '31', country: 'Pays-Bas', nsnMin: 9, nsnMax: 9 },
  { code: '61', country: 'Australie', nsnMin: 9, nsnMax: 9 },
];

// Recherche préfixe le plus long d'abord (ex. « 33 » vs « 3 »).
const SORTED_CODES = [...DIAL_CODES].sort((a, b) => b.code.length - a.code.length);

export async function GET(request: NextRequest) {
  const input = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (!input) {
    return NextResponse.json(
      { input: '', valid: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (input.length > MAX_Q_LEN) {
    return NextResponse.json(
      { input, valid: false },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Contexte international explicite ? On accepte « + » et le préfixe « 00 »
  // (les deux introduisent l'indicatif pays). Sans l'un des deux, on ne peut
  // pas déterminer le pays de façon fiable → country/valid restent vides.
  let intlDigits = '';
  if (input.startsWith('+')) {
    intlDigits = input.slice(1).replace(/\D/g, '');
  } else if (input.startsWith('00')) {
    intlDigits = input.slice(2).replace(/\D/g, '');
  }

  let country: string | undefined;
  let valid = false;
  let e164: string | undefined;

  if (intlDigits) {
    e164 = `+${intlDigits}`;
    // Préfixe le plus long d'abord (« 33 » avant « 3 »).
    const match = SORTED_CODES.find((c) => intlDigits.startsWith(c.code));
    if (match) {
      country = match.country;
      const nsnLen = intlDigits.length - match.code.length;
      valid = nsnLen >= match.nsnMin && nsnLen <= match.nsnMax;
    }
  }
  // Numéro national sans indicatif : pays non déterminable ici (indicatif requis)
  // → e164/country restent undefined, valid=false. Une validation opérateur
  //   réelle passerait par NUMVERIFY_KEY (voir en-tête).

  return NextResponse.json(
    { input, e164, country, valid },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
