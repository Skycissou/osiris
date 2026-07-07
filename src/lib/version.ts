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
export const OSIRIS_VERSION = 'V4.021-dev';

/** Libellé produit (sous-titre du header). */
export const OSIRIS_VERSION_LABEL = 'Cockpit OSINT';

/**
 * Historique des paliers (le plus récent EN PREMIER). Sert de changelog court
 * embarqué ; le détail vit dans VERSION.md. Date au format AAAA-MM-JJ.
 */
export const OSIRIS_VERSION_HISTORY: { version: string; date: string; resume: string }[] = [
  {
    version: 'V4.021-dev',
    date: '2026-07-07',
    resume:
      "\u2708\ufe0f Avions \u00d73 (retours Cissou) : \u2460 vraie silhouette d'avion de ligne " +
      "(Path2D 2\u00d7 anticr\u00e9nel\u00e9e, liser\u00e9 sombre + halo \u2014 fini l'Atari) \u2461 tra\u00een\u00e9es " +
      "enfin VISIBLES (le fondu partait du point le plus ancien \u2192 opacit\u00e9 0 apr\u00e8s 10 min " +
      "de suivi ; il part maintenant du plus r\u00e9cent) \u2462 d\u00e9zoom : grille 2\u00d72 de requ\u00eates " +
      "adsb.lol (max 4) \u2192 couverture continent au lieu d'un seul disque de 250 NM.",
  },
  {
    version: 'V4.020-dev',
    date: '2026-07-07',
    resume:
      "\u{1F30D} Couche g\u00e9opolitique RESSUSCIT\u00c9E : l'API GEO interactive de GDELT est " +
      "morte (vrai 404 \u2014 la couche n'a jamais rien affich\u00e9). Nouvelle source : fichiers " +
      "export 15-min de data.gdeltproject.org (lib/gdeltEvents, unzip fflate, filtre " +
      "conflits/manifestations, top 300, cache 15 min + stale-on-error). Carte inchang\u00e9e.",
  },
  {
    version: 'V4.019-dev',
    date: '2026-07-07',
    resume:
      "\u{1F6AA} Portier GDELT (lib/gdeltGate.ts) : GDELT rate-limite \u00e0 1 req/5 s par IP " +
      "(429 constat\u00e9 au test VPS) \u2192 file unique 5,5 s partag\u00e9e entre /news et la couche " +
      "g\u00e9opolitique + cache 5 min + stale-on-error + timeout 20 s. Script test-couches " +
      "am\u00e9lior\u00e9 (requ\u00eate g\u00e9o exacte de l'app, pause anti-429, d\u00e9tail par couche).",
  },
  {
    version: 'V4.018-dev',
    date: '2026-07-07',
    resume:
      "🐛 Avions figés sur la France : le handle useDataPolling était jeté → setBBox " +
      "jamais appelé → bbox défaut (France) pour toujours. La carte émet maintenant son " +
      "emprise (onBoundsChange, clampée ±180/±90) au chargement + à chaque moveend → " +
      "les couches denses suivent la carte. + scripts/test-couches.sh (teste toutes les " +
      "couches sans clé : amont + staging).",
  },
  {
    version: 'V4.017-dev',
    date: '2026-07-07',
    resume:
      "Page Clés API : scroll réparé (html/body overflow:hidden → la page porte son " +
      "propre conteneur h-screen overflow-y-auto). Clés PERSISTANTES entre versions : " +
      "env_file /docker/osiris-v4/.env (gitignoré, hors versions) chargé par le compose " +
      "staging — saisie UNE fois, survit aux pulls/rebuilds. .env.example nettoyé.",
  },
  {
    version: 'V4.016-dev',
    date: '2026-07-07',
    resume:
      "Clés API : page dédiée /cockpit/cles-api (plein écran, compteur X/13 clés " +
      "configurées, note sécurité, retours cockpit/accueil). Cœur extrait en " +
      "KeysManager.tsx (source unique) ; ancien panneau flottant KeysPanel archivé " +
      "dormant ; sidebars accueil+cockpit et ?panel=keys pointent sur la page.",
  },
  {
    version: 'V4.015-dev',
    date: '2026-07-07',
    resume:
      "Finitions sidebar (retours Cissou V4.014) : version sous le mot OSIRIS " +
      "(colonne, plus jamais tronquée) sur accueil ET cockpit ; barre de recherche " +
      "décalée de navW (fini le chevauchement) ; bouton flottant « ← Accueil » " +
      "desktop archivé (doublon sidebar) ; emojis retirés des groupes Outils/Doc ; " +
      "Prototype + Garde-fous déplacés dans Doc ; groupe Doc ajouté à la sidebar " +
      "cockpit (miroir accueil).",
  },
  {
    version: 'V4.014-dev',
    date: '2026-07-07',
    resume:
      "Réorg sidebar accueil : les outils (OSINT/Graphe/News/Clés) quittent la " +
      "carte pour la sidebar de l'accueil → deep-link /cockpit?panel=… (le cockpit " +
      "ouvre le panneau plein écran au montage via ?panel). Doc (Sources/Recettes/" +
      "Glossaire) regroupée sous 1 onglet repliable « 📚 Doc ». Badge version affiché " +
      "sur l'accueil (aligné sur ce fichier).",
  },
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
