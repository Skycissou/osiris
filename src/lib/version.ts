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
export const OSIRIS_VERSION = 'V4.027-dev';

/** Libellé produit (sous-titre du header). */
export const OSIRIS_VERSION_LABEL = 'Cockpit OSINT';

/**
 * Historique des paliers (le plus récent EN PREMIER). Sert de changelog court
 * embarqué ; le détail vit dans VERSION.md. Date au format AAAA-MM-JJ.
 */
export const OSIRIS_VERSION_HISTORY: { version: string; date: string; resume: string }[] = [
  {
    version: 'V4.027-dev',
    date: '2026-07-07',
    resume:
      "\u{1F504} COUCHE AVIONS R\u00c9\u00c9CRITE \u00c0 Z\u00c9RO (mod\u00e8le des apps d'origine) : un " +
      "COLLECTEUR permanent c\u00f4t\u00e9 serveur (lib/aircraftCollector) entretient l'\u00e9tat " +
      "monde en m\u00e9moire \u2014 1 t\u00e9l\u00e9chargement \u00e0 la fois, round-robin des zones vues, " +
      "OpenSky monde ~2 min. Les requ\u00eates carte ne t\u00e9l\u00e9chargent PLUS RIEN : elles " +
      "lisent l'\u00e9tat (< 10 ms). Champ debug `collector` dans la r\u00e9ponse.",
  },
  {
    version: 'V4.026-dev',
    date: '2026-07-07',
    resume:
      "\u{1F3C1} ANTI-COURSE (la vraie cause du chaos d'affichage) : les r\u00e9ponses " +
      "arrivaient dans le d\u00c9SORDRE (une vieille emprise \u00e9crasait la r\u00e9cente). " +
      "Client : 1 seule requ\u00eate vivante/endpoint (abort + s\u00e9quence, seule la plus " +
      "r\u00e9cente \u00e9crit) \u2014 la recette des apps de r\u00e9f\u00e9rence. Serveur : r\u00e9ponse " +
      "TOUJOURS imm\u00e9diate (fini l'attente 45 s), t\u00e9l\u00e9chargements en fond, " +
      "OpenSky 'warming' sans bloquer.",
  },
  {
    version: 'V4.025-dev',
    date: '2026-07-07',
    resume:
      "\u{1F6EB} Rendu avions fa\u00e7on app de r\u00e9f\u00e9rence : tra\u00een\u00e9e dessin\u00e9e UNIQUEMENT pour " +
      "l'avion s\u00e9lectionn\u00e9 (+ VIP) au lieu des centaines de micro-tirets (confettis) ; " +
      "m\u00e9moire des tuiles 2 \u2192 5 min pour qu'une r\u00e9gion ne se vide plus quand un " +
      "refresh amont rate (l'historique reste enregistr\u00e9 pour tous \u2192 cliquer un avion " +
      "r\u00e9v\u00e8le sa route pass\u00e9e).",
  },
  {
    version: 'V4.024-dev',
    date: '2026-07-07',
    resume:
      "\u{1F9F2} Anti-scintillement avions (zoom/d\u00e9zoom) : disques de requ\u00eate QUANTIFI\u00c9S " +
      "(centre au degr\u00e9, rayon au palier de 50 NM +45 de marge) \u2192 des vues voisines " +
      "r\u00e9utilisent le m\u00eame cache ; et en cas d'\u00e9chec amont la cl\u00e9 `aircraft` est " +
      "OMISE de la r\u00e9ponse \u2192 le client GARDE les avions affich\u00e9s au lieu de tout " +
      "effacer puis r\u00e9afficher.",
  },
  {
    version: 'V4.023-dev',
    date: '2026-07-07',
    resume:
      "\u{1F310} Vue MONDE des avions via OpenSky Network (compte gratuit, OAuth2, " +
      "instantan\u00e9 global ~2 min) quand la vue d\u00e9passe la port\u00e9e adsb.lol \u2014 2 nouveaux " +
      "services page Cl\u00e9s API (opensky_id/secret) + env. News : PLAN B automatique " +
      "Google Actualit\u00e9s RSS quand GDELT est en quota/panne. Feux (audit sous-agent) : " +
      "timeout 10\u219230 s + log si r\u00e9ponse FIRMS non-CSV (cl\u00e9 invalide visible).",
  },
  {
    version: 'V4.022-dev',
    date: '2026-07-07',
    resume:
      "\u{1FA79} Avions STABLES : cache serveur par tuile + refresh en fond (le VPS " +
      "t\u00e9l\u00e9charge adsb.lol \u00e0 ~300 Ko/25 s, timeout 8 s \u2192 quasi tout expirait : " +
      "scintillement, disques al\u00e9atoires, avions en mer). R\u00e9ponse instantan\u00e9e depuis " +
      "le cache (frais 12 s, p\u00e9rim\u00e9 servi < 2 min), 1 seul t\u00e9l\u00e9chargement/tuile, " +
      "timeout 45 s. Tra\u00een\u00e9es : pruneEntities retir\u00e9 (un tick rat\u00e9 effa\u00e7ait " +
      "l'historique \u2192 routes jamais visibles).",
  },
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
