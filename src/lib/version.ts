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
export const OSIRIS_VERSION = 'V4.070-dev';

/** Libellé produit (sous-titre du header). */
export const OSIRIS_VERSION_LABEL = 'Cockpit OSINT';

/**
 * Historique des paliers (le plus récent EN PREMIER). Sert de changelog court
 * embarqué ; le détail vit dans VERSION.md. Date au format AAAA-MM-JJ.
 */
export const OSIRIS_VERSION_HISTORY: { version: string; date: string; resume: string }[] = [
  {
    version: 'V4.070-dev',
    date: '2026-07-12',
    resume:
      "⚡ Data régional (demande Cissou) : les FEUX (FIRMS) sont scopés à la bbox du viewport au lieu du " +
      "monde → bien moins de data/ping en vue France/Europe (le CSV monde était énorme). `world` conservé " +
      "en vue Monde/zoom arrière. Les avions étaient déjà scopés au viewport. ⚠️ ALERTES disparitions " +
      "restent TOUJOURS mondiales (endpoint séparé, jamais scopé) → basculer en vue Monde les montre toutes.",
  },
  {
    version: 'V4.069-dev',
    date: '2026-07-12',
    resume:
      "🌍 Géopolitique — connecteur ACLED (conflits armés mondiaux) à la place de GDELT (bloqué depuis " +
      "l'IP VPS). Même forme de données (carte inchangée), gravité `goldstein` synthétique depuis le type " +
      "d'événement + morts. Clé gratuite : ACLED_KEY + ACLED_EMAIL (.env). Sans clé → repli GDELT. " +
      "Diag + voyant géopo câblés sur `acled`.",
  },
  {
    version: 'V4.068-dev',
    date: '2026-07-12',
    resume:
      "🔦 Vues — masque « projecteur » (demande Cissou) : la vue France assombrit TOUT le monde sauf la " +
      "France (métropole + Corse) → on ne voit QUE la France ; idem Europe ; Monde = sans masque. " +
      "Polygone à trous (monde - région) sous les données (marqueurs restent nets). `src/lib/spotlightMasks.ts`.",
  },
  {
    version: 'V4.067-dev',
    date: '2026-07-12',
    resume:
      "🧭 Cockpit — 3 VUES (🇫🇷 France / 🇪🇺 Europe / 🌍 Monde) avec le bon zoom (le zoom des presets était " +
      "ignoré, tout allait à zoom 8) + VOYANTS de connexion LIVE à côté des couches temps réel : 🟢 connecté/ops " +
      "· 🔴 pas connecté · 🟠 en cours, animés (vert/orange moulinent), dérivés du diag (poll 20 s). Demandes Cissou.",
  },
  {
    version: 'V4.066-dev',
    date: '2026-07-10',
    resume:
      "🔥 Feux — MULTI-CAPTEURS FIRMS. Diagnostiqué avec Cissou : clé valide (quota 0/5000) mais VIIRS " +
      "S-NPP renvoyait 0 ligne (flux NRT à sec). La couche interroge désormais NOAA-20 + S-NPP + MODIS " +
      "en parallèle et fusionne/déduplique → si un capteur est vide, les autres remplissent. Corrige " +
      "« feux absents malgré clé OK ».",
  },
  {
    version: 'V4.065-dev',
    date: '2026-07-09',
    resume:
      "🌍 Géocodage — fini les FAUX points en France. BAN est franco-français et « rapprochait » " +
      "AUCKLAND→Pas-de-Calais, LIMA→Lyon. Garde-fou : un résultat BAN n'est accepté que si le score ≥ 0,35 " +
      "ET que le libellé correspond vraiment (labelMatches). Repli MONDIAL Nominatim (rate-limité) pour les " +
      "disparus FR à l'étranger → vraie position. Si rien ne matche → PAS de pin (reste en liste), jamais un " +
      "point faux. Cache v3 : reset total (les faux succès sont ré-évalués).",
  },
  {
    version: 'V4.064-dev',
    date: '2026-07-09',
    resume:
      "🪪 Alertes — FICHE ENRICHIE + identique toutes sources + fix « 2 clics ». Champ générique `details` " +
      "(paires label→valeur, ex. Interpol signes distinctifs/taille/yeux/événement) accepté à l'ingest " +
      "(objet ou tableau, borné 12, anonymisé à la levée) et rendu à l'IDENTIQUE dans la fiche carte ET " +
      "la liste. Fix : kick de rechargement 1,6 s au 1er affichage → les alertes apparaissent sans devoir " +
      "cliquer 🔄 deux fois. Date d'événement affichée en liste.",
  },
  {
    version: 'V4.063-dev',
    date: '2026-07-09',
    resume:
      "🖐️ Alertes — PLACEMENT MANUEL + fiche de vérif (demande Cissou). La liste affiche la PHOTO " +
      "(via proxy, lazy) pour vérifier chaque avis ; pour un avis sans position (ex. Interpol), un champ " +
      "« ville / CP / département » + bouton 📍 le géocode et le pose sur la carte. Nouveau POST /cockpit/alerts/place " +
      "+ store d'override persistant (alerts-manual.json) ré-appliqué à chaque upsert → survit au ré-poll, " +
      "purgé avec l'avis. RGPD : seule la localité sort, jamais le nom.",
  },
  {
    version: 'V4.062-dev',
    date: '2026-07-09',
    resume:
      "📍 Alertes — géocodeur plus MALIN pour combler les « sans position ». Parse « Ville (CP) - Région » " +
      "→ requête STRUCTURÉE ville+CP (type=municipality) avant le texte libre → rattrape les 116000 que BAN " +
      "calait sur le format. Cache versionné (v2) : les échecs mémorisés par l'ancienne logique sont ré-essayés, " +
      "les succès conservés. (Les ~80 Interpol restent sans position : notices internationales sans lieu publié.)",
  },
  {
    version: 'V4.061-dev',
    date: '2026-07-09',
    resume:
      "🔁 Alertes — badge « non synchronisé » après redeploy corrigé. Fix A : le fichier alerts-sync.json " +
      "(qui persiste déjà sur le volume) est désormais RELU (gated mtime) comme les avis → un worker booté " +
      "avant la dernière synchro ne sert plus un timestamp figé. Fix B (bonus) : au (re)démarrage, ping unique " +
      "d'un webhook n8n de resynchro (env OSIRIS_RESYNC_WEBHOOK, fournie par chat) → resync en ~10 s au lieu " +
      "d'attendre le cron 15 min. Absente → no-op, ne bloque jamais le boot.",
  },
  {
    version: 'V4.060-dev',
    date: '2026-07-09',
    resume:
      "🧭 Cockpit — DISPO « zones fixes » (demande Cissou) : fini le chevauchement des fenêtres. " +
      "① Rail droit à UN SEUL panneau outil à la fois (ouvrir News ferme OSINT/Graphe, via openTool). " +
      "② La barre Alertes vit dans la bande LIBRE entre la sidebar et le rail droit (props leftOffset/" +
      "rightInset) → ne passe plus jamais sous un panneau ouvert, chips lisibles. Zones réservées.",
  },
  {
    version: 'V4.059-dev',
    date: '2026-07-09',
    resume:
      "🗂️ Alertes — REGISTRE UNIQUE des sources (src/lib/alertSources.ts) : ajouter une source = " +
      "1 ligne, tout en dérive (whitelist ingest, chips filtres, libellé fiche, catégorie par défaut). " +
      "Fini l'éparpillement dans 3 fichiers. 4 sources live prêtes à recevoir : Alerte Enlèvement, " +
      "Gendarmerie, Police nationale, Presse locale (chat branche les scrapers n8n ; OSIRIS géocode " +
      "leur lieu_texte tout seul via V4.058). Catégorie par défaut par source (ex. alerte_enlevement → enlevement).",
  },
  {
    version: 'V4.058-dev',
    date: '2026-07-09',
    resume:
      "📍 Alertes — GÉOCODAGE SERVEUR de la localité (demande Cissou) : tout avis avec une localité " +
      "en clair mais sans coordonnées est posé sur la carte automatiquement. Nouveau lib geocode.ts " +
      "(cache persistant geocache.json, BAN + repli IGN Géoplateforme, concurrence bornée). RGPD : " +
      "seule la localité sort, jamais le nom. Bénéficie aux sources futures (Lot 3 live) et rattrape " +
      "les 116000 non géocodés par n8n. Réponse ingest enrichie du compteur `geocoded`.",
  },
  {
    version: 'V4.057-dev',
    date: '2026-07-08',
    resume:
      "🔄 Alertes — « preuve de vie » de la couche : bouton 🔄 (re-poll immédiat, feedback rotation) " +
      "+ badge « synchro il y a X min » qui avance tout seul à l'écran (re-render 30 s) sans attendre " +
      "le poll 90 s. Répond à l'impression « ça ne se met pas à jour » alors que la donnée est stable " +
      "(les avis ne changent qu'à une nouvelle disparition / une levée). Pipeline confirmé live : cron " +
      "n8n auto 15 min + poll client 90 s.",
  },
  {
    version: 'V4.056-dev',
    date: '2026-07-08',
    resume:
      "🔧 Alertes — VRAIE cause du « figé à la 1ère insertion » : lecture, pas upsert. " +
      "ensureLoaded() rechargeait jamais le cache mémoire → avec >1 worker, le GET resservait " +
      "le snapshot de démarrage (categorie/photo/fetched_at gelés) même après des ingests 200. " +
      "Fix : rechargement gated par mtime du fichier. + Ingest tolère des alias d'id (source_id/id/" +
      "notice_id/reference) et renvoie received/accepted/dropped dans le 200 pour diagnostiquer d'un coup. " +
      "(L'upsert full-replace et le health par POST étaient DÉJÀ corrects.)",
  },
  {
    version: 'V4.055-dev',
    date: '2026-07-08',
    resume:
      "🖼️ Alertes — PROXY PHOTO same-origin (/cockpit/alerts/photo). Les photos des avis " +
      "(Interpol/116000) qui bloquent le hotlink ou sont servies en http s'affichent enfin : " +
      "re-servies en HTTPS depuis le cockpit. STREAMING PUR, zéro copie disque (RGPD §6 respecté). " +
      "Sécurisé anti-SSRF (résolution DNS + refus IP privées/loopback/link-local/métadonnées). " +
      "La fiche pointe désormais vers le proxy au lieu de l'URL brute.",
  },
  {
    version: 'V4.054-dev',
    date: '2026-07-08',
    resume:
      "🛡️ Alertes — GARDE-FOU lot vide : un scrape en échec (réseau/parser/source down) qui " +
      "renvoie [] ne déclenche PLUS la réconciliation → il ne « lève » plus d'un coup tous les avis " +
      "actifs ni ne vide la carte. La synchro est quand même enregistrée (monitoring §11). Corrige " +
      "la perte des avis après redéploiement quand le workflow n8n n'a pas encore reposté.",
  },
  {
    version: 'V4.053-dev',
    date: '2026-07-08',
    resume:
      "🟡 Alertes — ÉCHELLE DE COULEUR par récence/gravité (demande Cissou). Marqueur + halo " +
      "colorés selon l'âge de l'avis : 🔴 rouge vif <24 h → orange 1-3 j → jaune ~7 j → jaune pâle " +
      "au-delà (halo qui « glow » d'autant plus que c'est frais). Popup : ligne « publié il y a X » " +
      "colorée + placeholder « photo non fournie » quand il n'y a pas d'image. Liste : pastille de " +
      "récence + 📍 si géolocalisé. Légende récent→ancien dans la barre. (Photos = à envoyer par n8n.)",
  },
  {
    version: 'V4.052-dev',
    date: '2026-07-08',
    resume:
      "🟡 Alertes — correctifs UX (retours Cissou capture 08/07) : (1) la barre de contrôle " +
      "CHEVAUCHAIT la barre de recherche → descendue dessous (top 118). (2) « Interpol seul = carte " +
      "vide » : normal (Interpol Yellow n'a quasi jamais de coordonnées GPS) → ajout d'un compteur " +
      "« 📍 X sur carte · 📋 Y sans position » + une LISTE dépliable de TOUS les avis filtrés " +
      "(nom/catégorie/source/lieu + lien avis) → les avis non géolocalisés sont enfin visibles.",
  },
  {
    version: 'V4.051-dev',
    date: '2026-07-08',
    resume:
      "🟡 Alertes disparitions — Lot 2.5 (spec v1.1 §11/§12). ① champ `categorie` accepté à " +
      "l'ingest (taxonomie contrôlée, tolérance valeur inconnue → `disparition`), stocké + exposé. " +
      "② GET /cockpit/alerts/health (dernière synchro par source + nb actifs) + BADGE fraîcheur UI " +
      "(🟢<20min/🟠20-45/🔴>45). ③ CHIPS de filtre multi-sélection catégorie + source (compteurs) " +
      "dans la barre de contrôle de la couche. → GO Claude chat pour le parser n8n v3.",
  },
  {
    version: 'V4.050-dev',
    date: '2026-07-08',
    resume:
      "🟡 Alertes disparitions — Lot 2 (couche carte, demande Cissou « chaque alerte repérée sur " +
      "la carte »). Toggle « Alertes disparitions 🟡 » → marqueur jaune/orange à halo au point géo " +
      "de chaque avis (lit /cockpit/alerts, poll 90 s). Clic → fiche : photo (hotlink), identité, " +
      "lieu, source, lien « Voir l'avis officiel » + numéros utiles (17 / OCRVP / 116000). Avis " +
      "sans coordonnées = hors carte (pas de pin fantôme). Avis levé = marqueur gris anonymisé.",
  },
  {
    version: 'V4.049-dev',
    date: '2026-07-08',
    resume:
      "\u{1F7E1} Module « Alertes disparitions » — Lot 1 (spec Claude chat 08/07). Endpoints côté " +
      "OSIRIS : POST /cockpit/alerts/ingest (token OSIRIS_INGEST_TOKEN, alimenté par n8n) + GET " +
      "/cockpit/alerts (couche carto Lot 2). Store JSON persistant, dédup source+source_id, " +
      "RÉCONCILIATION (avis retiré → levée anonymisée) + PURGE 24 h + DELETE (RGPD dur : photos " +
      "hotlink jamais copiées, rien de nominatif après levée). n8n workflow = fait avec Claude chat. " +
      "⚠️ routes sous /cockpit (PAS /api/*, strippé vers V3). test-alerts.sh fourni.",
  },
  {
    version: 'V4.048-dev',
    date: '2026-07-07',
    resume:
      "\u{1F513} Outils OSINT enrichis (audit : champs déjà reçus mais jetés, gain gratuit sans " +
      "nouvelle clé). HIBP → types de données fuitées + volume + titre. OpenSanctions → MOTIFS " +
      "(topics : sanction/PPE/crime — dit POURQUOI l'entité ressort). AbuseIPDB → type d'usage " +
      "(datacenter/FAI), opérateur (ISP), domaine, Tor, signalants distincts. GitHub → e-mail " +
      "public, site, X, dernière activité + exclusion des forks. Affichage (renderData) mis à jour.",
  },
  {
    version: 'V4.047-dev',
    date: '2026-07-07',
    resume:
      "\u{1F6F0}️ Satellites réparés (diag : celestrak 657 échecs/663). CelesTrak RATE-LIMITE " +
      "dur → le code le martelait (2-8 requêtes/poll, à chaque poll de 120 s). Les TLE étant " +
      "valables plusieurs JOURS, on CACHE le blob TLE 6 h + stale-on-error 3 j (positions " +
      "recalculées à chaque requête via SGP4 depuis le cache → mouvement live conservé). CelesTrak " +
      "n'est plus appelé que ~quelques fois/jour → plus de rate-limit, la couche satellites revit.",
  },
  {
    version: 'V4.046-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4F0} Dépêches AFP (demande Cissou) : bouton « AFP » dans le fil d'actualité → dépêches " +
      "attribuées à l'Agence France-Presse via l'opérateur `source:AFP` de Google Actualités " +
      "(fenêtre 2 j, + thème si saisi). L'API AFP officielle étant licenciée/payante, le RSS Google " +
      "filtré source:AFP est la voie gratuite. Mode RSS-only (pas de GDELT). Tri par date conservé.",
  },
  {
    version: 'V4.045-dev',
    date: '2026-07-07',
    resume:
      "\u{1F30D} Couche géopolitique GDELT enrichie (audit : on lisait 8 colonnes sur 61). Ajout de " +
      "GoldsteinScale (GRAVITÉ −10..+10, colorée) + Actor1/Actor2 (QUI vs QUI) + id stable " +
      "GLOBALEVENTID → popup passe de « du bruit médiatique » à « qui, quoi, quelle gravité ». " +
      "+ télémétrie d'ÉCHEC `gdelt-export` (le diag dira enfin si data.gdeltproject.org est " +
      "bloqué depuis le VPS, comme api.gdeltproject.org).",
  },
  {
    version: 'V4.044-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4F0} News fraîcheur (retour Cissou : « la dernière info c'est il y a 7 h ») : (1) fil " +
      "SANS thème → « À LA UNE » Google Actualités (frais à la minute) au lieu d'une recherche " +
      "large qui remontait du vieux ; (2) TRI du plus récent au plus vieux (avant : ordre de " +
      "pertinence Google → le récent pas en haut) ; (3) le panneau se RAFRAÎCHIT tout seul toutes " +
      "les 5 min. La « dernière info » est maintenant réellement la plus récente, en haut.",
  },
  {
    version: 'V4.043-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4F0} News RSS-FIRST (preuve télémétrie : `gdelt-doc` timeout 8 s systématique = GDELT " +
      "bloque l'IP du VPS, alors que `google-rss` répond en 0,4 s avec 40 news fraîches). On MÈNE " +
      "désormais avec Google Actualités RSS, GDELT n'est plus qu'un secours si le RSS ne renvoie " +
      "rien → News rapides et FRAÎCHES (fini l'attente de 8 s et le cache figé). Bonus diag : " +
      "OpenSky vue monde confirmée OK (11 000+ avions) ; celestrak/satellites à réparer (bloqué VPS).",
  },
  {
    version: 'V4.042-dev',
    date: '2026-07-07',
    resume:
      "\u{1F30D} Couches séismes + cyber enrichies (lot « gratuit » de l'audit, suite). SÉISMES : " +
      "alerte PAGER (impact humain), \u{1F30A} alerte tsunami, IMPORTANCE, et surtout TYPE — un " +
      "« séisme » marqué explosion/tir près d'un site sensible = signal ARPD (bandeau rouge), " +
      "+ lien fiche USGS. CYBER C2 : port (IOC), statut en ligne/hors ligne, HÉBERGEUR (AS), " +
      "hôte, dernière activité — fini le point IP muet. Popups au clic enrichis.",
  },
  {
    version: 'V4.041-dev',
    date: '2026-07-07',
    resume:
      "\u{1F525} Feux enrichis (retour Cissou : « juste un point rouge, aucune info ») — 1er lot " +
      "« gratuit » de l'audit. On lisait 5 colonnes FIRMS sur 14 : ajout de FRP (puissance réelle " +
      "en MW), confiance, jour/nuit, satellite. La TAILLE et la COULEUR du point suivent " +
      "maintenant la puissance (gros brasier = gros point rouge vif, point chaud faible = petit " +
      "orange) + POPUP au clic (puissance, confiance, moment, satellite, heure). Fini le point muet.",
  },
  {
    version: 'V4.040-dev',
    date: '2026-07-07',
    resume:
      "\u{1F510} Coffre de clés SERVEUR + page admin (retour Cissou : « un vrai user peut pas " +
      "faire du SSH »). L'opérateur colle UNE fois les clés « couches » (OpenSky/FIRMS/AIS) dans " +
      "/cockpit/admin (protégé par token) → enregistrées côté serveur (volume persistant, jamais " +
      "git), lues par le collecteur d'avions ET les couches → la vue monde OpenSky marche sans " +
      "SSH ni .env, pour TOUS. Priorité : en-tête navigateur → coffre → env. Clés perso OSINT " +
      "restent au navigateur. Diag : bloc `serverStore` ajouté. Valeur jamais exposée (présence+len).",
  },
  {
    version: 'V4.039-dev',
    date: '2026-07-07',
    resume:
      "\u{1F511} Diag clarifié (retour Cissou : « FIRMS je vois les feux, OpenSky j'ai rentré " +
      "les identifiants ») : le bloc `env` ne reflète QUE le .env SERVEUR, pas les clés saisies " +
      "dans l'app (navigateur, en-tête par requête) → `present:false` n'était pas « pas de clé ». " +
      "Note explicite ajoutée. Point clé : OpenSky vue monde EXIGE le .env serveur (collecteur " +
      "permanent, `lastGlobalAgeS:null` = jamais récupéré) → utiliser « Copier pour le .env ».",
  },
  {
    version: 'V4.038-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4F0} News « tourne sans fin » ENFIN diagnostiquée par la télémétrie (gdelt-doc " +
      "abort à 20 s = GDELT bloque l'IP du VPS). DEUX bugs cumulés corrigés : (1) client " +
      "NewsPanel — sur timeout local, `loading` n'était jamais remis à false → SPINNER INFINI " +
      "(flag `timedOut` pour distinguer timeout vs recherche supplantée) ; (2) serveur — GDELT " +
      "timeout 20 s→8 s (échoue vite), plan B RSS 9 s→7 s, timeout client 12 s→18 s (couvre " +
      "le pire cas). + télémétrie `google-rss` dans le diag (on voit enfin si le plan B répond).",
  },
  {
    version: 'V4.037-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4F0} News figées (retour Cissou : « 8 h que ce n'est pas à jour ») : le portier " +
      "GDELT resservait le cache périmé SANS limite d'âge quand GDELT ramait → news gelées " +
      "des heures. Corrigé : (1) stale-on-error BORNÉ à 30 min (au-delà le portier rend null) ; " +
      "(2) la route /news, dès qu'elle reçoit du périmé, bascule d'ABORD sur Google Actualités " +
      "RSS (frais) et ne sert le périmé qu'en dernier recours. Audit données OpenSky livré au " +
      "brain (8/17 champs consommés ; category+squawk jetés = avions monde bleus).",
  },
  {
    version: 'V4.036-dev',
    date: '2026-07-07',
    resume:
      "\u{1F511} OpenSky enfin clair (retour Cissou : « je vois 1 seul champ ») : les 2 " +
      "cartes (identifiant + secret) existaient mais se ressemblaient trop. L'IDENTIFIANT " +
      "client OAuth2 n'étant PAS un secret, il s'affiche désormais EN CLAIR (champ texte " +
      "vert, badge « identifiant · pas un secret · visible ») → impossible à confondre avec " +
      "le secret masqué. Libellés « CHAMP 1/2 » / « CHAMP 2/2 » + « 👉 colle ICI ». Flag " +
      "meta `secret:false` réutilisable pour tout futur identifiant non sensible.",
  },
  {
    version: 'V4.035-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4E1} TÉLÉMÉTRIE UI (option B, spec Claude) : traçage anonyme de TOUTES les " +
      "actions in-app (couches, recherches, OSINT, clics news, sauvegarde de clé — " +
      "JAMAIS la valeur, seulement le service —, déplacements carte) + captures auto " +
      "(page, fetch applicatif, erreurs JS/promesses). Ingest same-origin, rate-limité, " +
      "kill-switch OSIRIS_UI_TELEMETRY=off ; stockage JSONL purgé à 7 j (ni IP ni " +
      "user-agent). Page /cockpit/diag (token OSIRIS_DIAG_TOKEN) : timeline FUSIONNÉE " +
      "action UI → fetch → appel amont → erreur, par session → on voit où ça casse. " +
      "SECURITY.md + scripts/test-telemetrie.sh.",
  },
  {
    version: 'V4.034-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4CB} Bouton « Copier pour le .env » sur la page Cl\u00e9s API : g\u00e9n\u00e8re les lignes " +
      "VAR=valeur \u00e0 partir des cl\u00e9s d\u00e9j\u00e0 dans le navigateur \u2192 \u00e0 coller UNE fois dans " +
      "/docker/osiris-v4/.env (coffre serveur bug-proof, survit \u00e0 tout). Cissou ne recr\u00e9e " +
      "aucune cl\u00e9.",
  },
  {
    version: 'V4.033-dev',
    date: '2026-07-07',
    resume:
      "\u{1F41B} Plus aucun avion depuis la cl\u00e9 OpenSky : le collecteur affamait adsb.lol " +
      "quand OpenSky ne r\u00e9pondait pas \u2192 adsb.lol collect\u00e9 EN PERMANENCE, OpenSky bonus " +
      "non-bloquant. OpenSky doc v\u00e9rifi\u00e9e (OAuth2 id+secret) \u2192 howTo pr\u00e9cis\u00e9 (client_id " +
      "+ client_secret obligatoires, secret affich\u00e9 1 fois). Version accueil ASSUJETTIE au " +
      "cockpit : endpoint /cockpit/version lu par l'accueil (fini le lockstep manuel).",
  },
  {
    version: 'V4.032-dev',
    date: '2026-07-07',
    resume:
      "\u{1F9EA} Bouton « Tester » par cl\u00e9 (demande Cissou : « \u00e7a dit OK mais je vois pas " +
      "si c'est connect\u00e9 ») : route /cockpit/keys/test fait un VRAI appel \u00e0 la source avec " +
      "la cl\u00e9 \u2192 \u2705 connect\u00e9 / \u274c + raison (401, quota\u2026). Couvre FIRMS, OpenSky, Shodan, " +
      "HIBP, AbuseIPDB, GitHub, OpenSanctions, AIS. Cl\u00e9 jamais renvoy\u00e9e au client (safeFetch).",
  },
  {
    version: 'V4.031-dev',
    date: '2026-07-07',
    resume:
      "\u{1F511} /live-feed/diag : bloc `env` \u2014 pour chaque cl\u00e9 attendue (.env VPS), " +
      "pr\u00e9sence + longueur (JAMAIS la valeur). Permet de v\u00e9rifier que la barri\u00e8re " +
      "d'environnement est bien charg\u00e9e sans re-chercher ses cl\u00e9s ni d\u00e9clencher les couches " +
      "(demande Cissou).",
  },
  {
    version: 'V4.030-dev',
    date: '2026-07-07',
    resume:
      "\u2708\ufe0f Avions « toujours bleus » corrig\u00e9 : la category ADS-B est rare c\u00f4t\u00e9 " +
      "adsb.lol \u2192 REPLI sur le type ICAO (`t` : A320\u2192grand, A388\u2192gros porteur, EC35\u2192" +
      "h\u00e9lico, C172\u2192l\u00e9ger, F16\u2192mil) + URGENCE rouge vif (squawk 7500/7600/7700). Logique " +
      "extraite en lib/aircraftCategory.ts (test\u00e9e 17/17). Bandeau urgence + squawk dans la fiche.",
  },
  {
    version: 'V4.029-dev',
    date: '2026-07-07',
    resume:
      "\u{1F4CA} MONITORING de toutes les requ\u00eates amont (demande Cissou) : V4 lib/telemetry " +
      "+ route /cockpit/live-feed/diag ; V3 http.record_call + endpoint /diag \u2014 ok/\u00e9chec, " +
      "latence, nb d'\u00e9l\u00e9ments PAR source. Exploitation des donn\u00e9es (audit) : V3 prix/m\u00b2 DVF, " +
      "vraie m\u00e9diane, BODACC jugement/acte structur\u00e9s, contexte BAN, URL data.gouv, fields geo " +
      "\u00e9largis, per_page 25 (pytest OK) ; V4 celestrak GROUP (2 appels \u2192 centaines de satellites).",
  },
  {
    version: 'V4.028-dev',
    date: '2026-07-07',
    resume:
      "\u2708\ufe0f Avions color\u00e9s par CAT\u00c9GORIE (militaire/gros porteur/grand/h\u00e9lico/" +
      "l\u00e9ger/inconnu) via `category`+bit militaire d'adsb.lol, avec l\u00e9gende. Fiche avion : " +
      "immatriculation + type ICAO (champs `r`/`t` jusque-l\u00e0 jet\u00e9s) + TRAJET d\u00e9part\u2192" +
      "arriv\u00e9e r\u00e9solu au clic via adsbdb.com (gratuit, sans cl\u00e9).",
  },
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
