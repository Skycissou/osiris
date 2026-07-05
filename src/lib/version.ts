// ─────────────────────────────────────────────────────────────────────────
//  OSIRIS — VERSION (source unique de vérité)
//  ─────────────────────────────────────────────────────────────────────────
//  Toute la version du cockpit vit ICI. Le header (page.tsx) l'affiche, la doc
//  (VERSION.md) la référence, le brain la suit. NE JAMAIS coder un numéro de
//  version en dur ailleurs : importer `OSIRIS_VERSION` depuis ce fichier.
//
//  RÈGLE DE VERSIONING (voir VERSION.md pour le détail complet) :
//    Format  →  V<MAJEUR>.<PALIER>[-<état>]
//    • MAJEUR : refonte d'architecture. V3 = FastAPI + vanilla JS.
//               V4 = cockpit Next.js + MapLibre. Change TRÈS rarement.
//    • PALIER : entier sur 3 chiffres, +1 à CHAQUE chantier livré
//               (build vert + push). Monotone, jamais réutilisé.
//    • état   : suffixe optionnel « -dev » tant que non déployé en prod ;
//               retiré au déploiement. Ex. « V4.003-dev » → « V4.003 ».
//
//  PROCÉDURE À CHAQUE CHANTIER (dans le pipeline) :
//    1. Incrémenter OSIRIS_VERSION (palier +1).
//    2. Ajouter une entrée en tête de OSIRIS_VERSION_HISTORY (date + résumé).
//    3. Compléter VERSION.md (même changelog, plus détaillé).
//    4. Retirer « -dev » au moment du déploiement prod.
// ─────────────────────────────────────────────────────────────────────────

/** Version courante affichée dans l'UI et tracée dans le brain. */
export const OSIRIS_VERSION = 'V4.013-dev';

/** Libellé produit (sous-titre du header). */
export const OSIRIS_VERSION_LABEL = 'Cockpit OSINT';

/**
 * Historique des paliers (le plus récent EN PREMIER). Sert de changelog court
 * embarqué ; le détail vit dans VERSION.md. Date au format AAAA-MM-JJ.
 */
export const OSIRIS_VERSION_HISTORY: { version: string; date: string; resume: string }[] = [
  {
    version: 'V4.013-dev',
    date: '2026-07-05',
    resume:
      "Filtres d'attributs (filtrer DANS une couche : altitude/vitesse/militaire/VIP, " +
      "magnitude, tonalité, malware). Confort UI : raccourcis clavier, presets de vue, " +
      "partage de lien, barre d'échelle. (Briefing IA construit puis MIS DE CÔTÉ à la " +
      "demande de Cissou — code dormant, débranché de l'UI.)",
  },
  {
    version: 'V4.012-dev',
    date: '2026-07-05',
    resume:
      "Couches Géopolitique (GDELT) + Cyber (C2 abuse.ch), gratuites sans clé, dans le flux " +
      "slow. Fil d'actualité /news (GDELT DOC) + NewsPanel.",
  },
  {
    version: 'V4.005-dev',
    date: '2026-07-05',
    resume:
      "Style aligné sur l'accueil (langage visuel de la landing : pills, cartes, " +
      "glass-panel, focus rings, hover premium). Couche satellites (celestrak + SGP4). " +
      "Fondations formes public/perso + modale de consentement (form 2).",
  },
  {
    version: 'V4.004-dev',
    date: '2026-07-05',
    resume:
      "Avions fluides : interpolation dead-reckoning (cap + vitesse) toutes les 2 s " +
      "entre les fetches 15 s → les aéronefs glissent au lieu de sauter (rendu radar live).",
  },
  {
    version: 'V4.003-dev',
    date: '2026-07-05',
    resume:
      "Vague multi-couches temps réel : séismes (USGS), feux (FIRMS), volcans (stub) ; " +
      "tagging VIP avions ; système d'alertes toasts ; dossier de zone au clic droit " +
      "(Nominatim/restcountries/Wikidata) ; versioning + doc d'architecture.",
  },
  {
    version: 'V4.002',
    date: '2026-07-05',
    resume: "1ère couche temps réel : avions live (adsb.lol), route + carte + toggle FR.",
  },
  {
    version: 'V4.001',
    date: '2026-07-05',
    resume:
      "Re-skin charte OSIRIS V3 (bleu-cyan) + fondations clean-room : registre " +
      "déclaratif de couches, store par-clé, moteur de polling temps réel.",
  },
];
