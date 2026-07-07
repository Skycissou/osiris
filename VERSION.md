# OSIRIS — Versioning & Changelog

> Source unique de vérité du numéro de version : [`src/lib/version.ts`](src/lib/version.ts) (`OSIRIS_VERSION`).
> Ce fichier documente **la règle** et tient le **changelog détaillé**. À jour à chaque chantier.

## 📐 Règle de versioning

Format : **`V<MAJEUR>.<PALIER>[-<état>]`**

| Composant | Sens | Quand ça change |
|---|---|---|
| **MAJEUR** | Refonte d'architecture. `V3` = FastAPI + vanilla JS · `V4` = cockpit Next.js + MapLibre. | Très rarement (nouvelle génération). |
| **PALIER** | Entier sur **3 chiffres** (`001`, `002`, …). **+1 à chaque chantier livré** (build vert + push). Monotone, **jamais réutilisé**. | À chaque chantier terminé. |
| **-état** | Suffixe optionnel `-dev` tant que le palier n'est **pas déployé en prod**. Retiré au déploiement. | Au déploiement prod. |

**Lecture rapide** : « on en est au palier 3 » = `V4.003`. Le numéro monte, on voit toujours où on en est.

## 🔁 Procédure à chaque chantier (dans le pipeline)

1. **Incrémenter** `OSIRIS_VERSION` dans `src/lib/version.ts` (palier +1, suffixe `-dev`).
2. **Ajouter une entrée** en tête de `OSIRIS_VERSION_HISTORY` (date + résumé court).
3. **Compléter ce fichier** (`VERSION.md`) : nouvelle section changelog détaillée.
4. **Build vert + push** sur la branche de dev.
5. **Au déploiement prod** : retirer `-dev` (dans `version.ts` + ici).

Le header du cockpit (`src/app/page.tsx`) affiche `OSIRIS_VERSION` → la version est visible en permanence dans l'UI.

---

## 📜 Changelog

### V4.030-dev — 2026-07-07 — ✈️ Avions « toujours bleus » réparé (repli type ICAO) + urgence
- **Cause (retour Cissou)** : la catégorie émetteur ADS-B (`category` A1..A7) n'est renvoyée par adsb.lol que pour une minorité d'avions → sans elle, tout retombait sur « inconnu » (gris-bleu ≈ bleu).
- **Fix — cascade de signaux** dans `lib/aircraftCategory.ts` (module PUR, **testé 17/17**) : urgence (squawk 7500/7600/7700 ou champ `emergency`) → militaire (bit dbFlags **ou type ICAO** F16/C130…) → `category` ADS-B → **REPLI sur le TYPE ICAO `t`** (A388→gros porteur, A320/B738→grand, EC35→hélico, C172→léger) → défaut. Résultat : la quasi-totalité des avions est colorée.
- **Urgence en rouge vif** : nouvelle catégorie `emergency` (couleur + icône + légende) ; **bandeau 🚨 URGENCE** + ligne **Squawk** dans la fiche avion (7500 détournement / 7600 panne radio / 7700 urgence).
- Champs `squawk`/`emergency` désormais collectés (adsb.lol) et propagés jusqu'à la carte.

### V4.029-dev — 2026-07-07 — 📊 Monitoring des requêtes + exploitation des données (phase 1)
- **MONITORING (demande Cissou « installe quelque chose qui monitore toutes les requêtes »)** :
  - **V4** : `lib/telemetry.ts` (anneau 200 + compteurs par source) branché sur adsb.lol, USGS, celestrak, FIRMS, gdelt-doc, gdelt-export, abuse.ch, opensky. Endpoint **`GET /cockpit/live-feed/diag`** → ok/échec, latence, nb d'éléments par source + santé du collecteur. Testé (fixture : compteurs ok/fail, recent).
  - **V3** : `http.record_call` (dans le fetcher partagé, capture TOUT appel amont) + endpoint **`GET /diag`**. Testé (pytest).
- **Exploitation des données jetées (audit, phase 1) — V3, testé pytest** : **prix au m²** DVF (+ coords des ventes), **vraie médiane** (le libellé annonçait médiane, calculait la moyenne), **BODACC `jugement`/`acte` structurés** (nature réelle de procédure + capital social), **contexte BAN** (dépt+région, importance, banID), **URL réelle data.gouv** (+ liens ressources, tri par fraîcheur), **fields geo élargis** (centre/surface/EPCI/SIREN commune), **per_page 10→25**, **BODACC limit 5→10**.
- **Optimisation requêtes — V4** : satellites via **`GROUP=visual`+`GROUP=stations`** (2 appels → des centaines de satellites, plafonné 300) au lieu de 6 appels CATNR pour 6 satellites ; repli sur le seed si groupes indisponibles.
- ⏭️ Phase 2 (à suivre) : enrichissement des popups live (USGS tsunami/alerte, Feodo port/statut, GDELT acteurs/Goldstein, adsb squawk/urgence) + wins OSINT (ip timezone/flag, github html_url, cve severity, dns CAA).

### V4.028-dev — 2026-07-07 — ✈️ Couleur par catégorie + trajet départ/arrivée (retours Cissou)
- **Couleur par CATÉGORIE d'avion** (« tout est bleu ») : le collecteur récupère maintenant `category` (A1..A7) + le bit **militaire** de `dbFlags` (jusque-là jetés). Buckets colorés : militaire (rouge), gros porteur A5 (orange), grand avion A3/A4 (violet), hélicoptère A7 (vert), léger A1/A2 (cyan), autre/inconnu (gris-bleu). Une icône par couleur (Path2D) + `iconId` data-driven sur la couche symbole + **légende** en bas à droite quand la couche Avions est active.
- **Trajet départ → arrivée** (« savoir le point de départ et d'arrivée ») : au clic sur un avion, la fiche résout la route via **adsbdb.com** (gratuit, sans clé, CORS ouvert) — aéroports d'origine et destination (code IATA/ICAO + ville). Cache mémoire (échecs inclus), en parallèle de la photo. Indicatif inconnu → section masquée (dégradation douce).
- **Fiche avion enrichie** : ajout de l'**immatriculation** (`r`) et du **type ICAO** (`t`) — deux champs qu'adsb.lol envoyait et qu'on jetait (cf. audit V4 quick win #2).
- Aucune clé requise pour tout ça. Couches/collecteur/anti-course (V4.027) inchangés.

### V4.027-dev — 2026-07-07 — 🔄 COUCHE AVIONS RÉÉCRITE À ZÉRO (architecture collecteur)
- **Décision Cissou** (« reprendre cette couche-là à zéro, voir ce que l'app d'origine applique ») : on adopte le modèle des apps fluides (FR24, tar1090…) — **l'affichage ne déclenche JAMAIS de téléchargement**.
- **`lib/aircraftCollector.ts`** : boucle permanente côté serveur (1 tick / 8 s, **UN téléchargement à la fois**, jamais de parallélisme) qui entretient un **état monde en mémoire** (avions + fraîcheur). Les vues déclarent leurs « zones d'intérêt » (disques quantifiés, round-robin, expiration 10 min) ; OpenSky monde rafraîchi ~2 min quand une vue large l'a demandé. Avion non revu : hors affichage à 5 min, hors mémoire à 10 min.
- **La route `/live-feed/fast` ne fait plus que LIRE** : `registerInterest(bbox)` + `getAircraftInBBox(bbox)` → réponse < 10 ms, TOUJOURS, quel que soit l'état de l'amont. Fini les réponses qui variaient de 0,1 s à 45 s (source des courses et du chaos).
- **Bonus débit** : fini les 4 téléchargements parallèles qui s'étranglaient mutuellement sur le lien lent du VPS (le « 300 Ko en 25 s » mesuré était en partie auto-infligé) — en séquentiel, chaque téléchargement va plus vite.
- **Debug embarqué** : la réponse contient `collector: { tracked, zones, lastGlobalAgeS }` → dans l'onglet Network on voit d'un coup d'œil si le collecteur suit des avions. Ancien mécanisme « cache par tuile » archivé dans la route (plus référencé).
- Conservés : anti-course client (V4.026), quantification des disques (V4.024), icône + traînée sélection (V4.021/025), interpolation 2 s.

### V4.026-dev — 2026-07-07 — 🏁 ANTI-COURSE : la vraie cause du chaos d'affichage
- **Diagnostic à froid (retour Cissou : « tuiles qui apparaissent/disparaissent France-Europe-USA, zoom inutilisable »)** : les requêtes du client n'étaient **ni annulées ni ordonnées**. Avec un serveur qui pouvait bloquer jusqu'à 45 s (attente d'un téléchargement), une **VIEILLE réponse** (ancienne emprise, ex. France) arrivait APRÈS une récente (ex. monde) et **écrasait le store** → l'affichage sautait d'une emprise à l'autre en boucle. Aucun des patchs précédents n'attaquait ce point.
- **Client (`liveData.ts`) — la recette des apps de référence** : ① la nouvelle requête **annule** la précédente (AbortController par endpoint) ; ② numéro de **séquence** par endpoint — seule la réponse de la requête la plus récente a le droit d'écrire dans le store, re-vérifié APRÈS lecture du corps ; ③ AbortError silencieux.
- **Serveur (`fast/route.ts`) — réponse TOUJOURS immédiate** : `fetchAdsbTile` ne bloque plus jamais sur un téléchargement (fini l'attente 45 s) — cache frais/périmé servi tel quel, sinon « pas de mise à jour ce tick » (clé `aircraft` omise) pendant que la tuile chauffe en fond. Le tick suivant (15 s) récolte.
- **OpenSky** : `getGlobalAircraft` devient synchrone avec état `'warming'` — la vue monde « chauffe » sans bloquer ni afficher des disques incohérents pendant le premier téléchargement.

### V4.025-dev — 2026-07-07 — 🛫 Rendu avions façon « app de référence »
- **Diagnostic (screenshot Cissou : nuée de micro-tirets « confettis » sur l'Europe, icônes seulement par endroits)** : on dessinait la traînée de TOUS les avions vus dans les 10 dernières minutes — y compris ceux sortis du flux — soit des centaines de segments courts illisibles ; et une tuile expirant à 2 min faisait disparaître SA région entière quand 2-3 refreshes rataient.
- **Traînée = avion SÉLECTIONNÉ uniquement (+ VIP)** — comme Flightradar24 & co : la carte reste propre, et comme l'**historique est enregistré pour tous**, cliquer n'importe quel avion révèle instantanément sa route passée (jusqu'à 10 min). Les VIP gardent leur traînée en permanence (c'est l'intérêt du tag).
- **Mémoire des tuiles 2 → 5 min** : une région ne se vide plus quand l'amont rame ; au pire la position a ~40 NM de retard, l'interpolation lisse le reste.

### V4.024-dev — 2026-07-07 — 🧲 Anti-scintillement avions au zoom/dézoom
- **Diagnostic (retour Cissou : « je peux pas zoomer/dézoomer sinon tout disparaît »)** : le cache V4.022 était indexé sur la géométrie EXACTE des disques (centre à 4 décimales, rayon au NM) → le moindre zoom/pan changeait la clé → cache vide → re-téléchargement 25-40 s pendant lequel la couche se vidait.
- **Fix 1 — disques QUANTIFIÉS** : centre arrondi au degré, rayon au palier de 50 NM supérieur (+45 NM de marge pour couvrir le décalage) → des vues voisines (zoom in/out, petits pans) frappent les MÊMES disques → cache réutilisé → affichage stable.
- **Fix 2 — jamais d'effacement sur échec** : quand toutes les tuiles échouent, la réponse **omet la clé `aircraft`** au lieu d'envoyer `[]` → `mergeData` côté client ne touche pas aux avions affichés (il n'écrase que les clés présentes). L'échec devient « pas de mise à jour » au lieu de « écran vide ».
- Feux : rien de neuf côté code (cf. V4.023) — vérifier la CLÉ FIRMS (page Clés API, statut ✔) et le toggle **Couches → Feux** (pas le panneau Filtres) ; `docker logs osiris-v4-cockpit` dit désormais si FIRMS rejette la clé.

### V4.023-dev — 2026-07-07 — 🌐 Vue MONDE (OpenSky) + plan B news (RSS) + feux traçables
- **Vue MONDE des avions** (GO Cissou, option A) : quand la vue dépasse la portée d'adsb.lol (> 700 NM nécessaires), la route fast sert l'**instantané global OpenSky Network** (~8-12 000 avions, rafraîchi ~2 min, cache serveur + stale). `lib/openskyGlobal.ts` : OAuth2 client-credentials (jeton mis en cache), normalisation vers la MÊME forme qu'adsb.lol (kt/ft) → zéro changement client. **Sans identifiants → comportement actuel** (tuilage), rien ne casse.
- **Page Clés API** : 2 nouveaux services **`OpenSky — identifiant client`** et **`OpenSky — secret client`** avec protocole complet (compte gratuit → Account → API Client → copier client_id/client_secret) + env `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET` (persistant via `/docker/osiris-v4/.env`). Transport auto vers les flux live (`LIVE_KEY_SERVICES`).
- **News — PLAN B automatique** : GDELT en quota/timeout/panne → bascule transparente sur le **flux RSS public Google Actualités** (gratuit, sans clé, mêmes champs d'article, FR/EN selon le filtre). L'erreur GDELT n'est montrée que si le plan B échoue aussi.
- **Feux (audit du sous-agent : chaîne code correcte, cause = clé/source)** : timeout des sources slow **10 s → 30 s** (le CSV FIRMS monde était coupé en plein téléchargement) + **log explicite** quand FIRMS répond un message au lieu du CSV (clé invalide/quota — avant c'était 100 % silencieux). Vérifs utilisateur : localStorage `osiris-apikey-firms`, en-tête `x-osiris-key-firms` dans l'onglet Network, et tester sa clé sur `firms.modaps.eosdis.nasa.gov/api/area/csv/CLÉ/VIIRS_SNPP_NRT/world/1`.

### V4.022-dev — 2026-07-07 — 🩹 Avions STABLES : cache par tuile + traînées qui survivent aux ticks ratés
- **Diagnostic (screenshot Cissou : scintillement, disques qui sautent, avions « dans l'océan »)** : le lien VPS↔adsb.lol est **lent** (~300 Ko en 25 s mesuré au script) alors que le timeout était de **8 s** et le polling de 15 s → presque toutes les tuiles 250 NM expiraient ; celle qui passait affichait SON disque (centré sur un quadrant → parfois la mer), puis disparaissait au tick suivant.
- **Fix : cache serveur PAR TUILE + refresh en fond** (même philosophie que le portier GDELT) : réponse **instantanée** depuis le cache (frais < 12 s ; périmé servi jusqu'à 2 min pendant qu'un refresh tourne), **un seul téléchargement à la fois par tuile**, timeout monté à **45 s** (on laisse le téléchargement finir). Résultat : affichage stable, les 4 quadrants se remplissent au fil des refreshes, plus de trous ni de clignotement — la fluidité visuelle reste assurée par l'interpolation 2 s.
- **🐛 Traînées (suite et fin)** : `pruneEntities` effaçait l'historique de tout avion **absent du dernier tick** — avec un flux qui rate des ticks, les routes ne se construisaient JAMAIS (même après le fix V4.021 du fondu). Retiré (avions + navires) : l'élagage par ÂGE (10 min) de `recordPositions`/`buildTrails` suffit et borne la mémoire.
- Reste vrai : la vue monde entière n'est couverte que partiellement (4 disques de 250 NM max — limite de la source gratuite).

### V4.021-dev — 2026-07-07 — ✈️ Avions ×3 : icône digne, traînées visibles, couverture dézoom
- **Icône refaite** (retour Cissou « années 80 Atari ») : vraie silhouette d'avion de ligne vue de dessus (fuselage effilé + ailes en flèche + empennage), tracée en `Path2D`, rendue **2×** (`pixelRatio`) → anticrénelée, liseré sombre (lisible sur satellite) + léger halo. Tracé clean-room.
- **🐛 Traînées invisibles** (retour « on ne voit pas les routes ») : le fondu (`ageRatio`) partait du point **le plus ANCIEN** → un avion suivi 10 min avait ratio ≈ 1 → opacité ≈ 0 → toutes les routes des avions actifs disparaissaient. Il part maintenant du **plus RÉCENT** : traînée pleinement visible tant que l'avion émet, fondu seulement après sa disparition du flux. Trait épaissi (1,4→2,4 px selon zoom).
- **Couverture en dézoom** (retour « que la France et 1 état USA ») : quand la vue dépasse un disque de 250 NM (limite `/v2/point` d'adsb.lol), la bbox est découpée en **grille 2×2** (max 4 requêtes parallèles, politesse envers la source gratuite), tuiles fusionnées + dédupliquées par hex → couverture continent. La vue MONDE entière reste partielle — limite assumée de la source gratuite.
- News : rien à corriger côté code — « quota GDELT atteint » = pénalité temporaire de l'IP chez GDELT (laisser refroidir, le portier V4.019 protège).

### V4.020-dev — 2026-07-07 — 🌍 Couche géopolitique ressuscitée (fichiers export GDELT)
- **Constat (matrice de curls VPS)** : l'API GEO interactive (`api.gdeltproject.org/api/v2/geo/geo`) renvoie un **vrai 404 serveur** quelle que soit la requête → morte/retirée. La couche géopolitique n'a donc **jamais rien affiché** depuis V4.012 (échec silencieux, `gdelt:0`).
- **Nouvelle source (GO Cissou, option A)** : les **fichiers export 15-min** de `data.gdeltproject.org` (`lastupdate.txt` → `.export.CSV.zip`, table « GDELT 2.0 Event Database », 61 colonnes) — autre hôte, **pas de rate-limit interactif**, gratuit sans clé.
- **`lib/gdeltEvents.ts`** : lastupdate → zip → unzip (**fflate**, nouvelle dépendance ~8 Ko) → TSV → filtre points chauds (QuadClass 3/4 = conflits, ou racine CAMEO 14 = manifestations) → dédup par point (garde le + couvert) → **top 300 par nb d'articles** → même forme `GdeltEvent` (id/lat/lng/name/count/url/tone) → **zéro changement côté carte** (popups + filtre tonalité intacts).
- **Cache 15 min** (rythme de publication GDELT) + **stale-on-error** + garde-fou 30 Mo + un seul téléchargement concurrent. L'ancien chemin GEO (GDELT_GEO_TMPL/parseGdelt) reste archivé dans la route.
- Script test-couches : la ligne « GDELT geo » (API morte) devient « GDELT files » (lastupdate.txt).
- Le portier `gdeltGate` (V4.019) reste en service pour `/news` (API DOC, elle, vivante mais rate-limitée).

### V4.019-dev — 2026-07-07 — 🚪 Portier GDELT (fin des « timeout GDELT »)
- **Diagnostic (script test-couches sur le VPS)** : GDELT répond **429** avec le message « limit requests to one every 5 seconds » — `/news` et la couche géopolitique (`/live-feed/slow`, toutes les 120 s) + les refresh du panneau se marchaient dessus depuis la même IP → GDELT ralentissait/refusait → « timeout GDELT ».
- **Fix : `lib/gdeltGate.ts`**, portier UNIQUE pour tout appel GDELT : ① file sérialisée, **1 requête / 5,5 s** max (leur règle + marge) ② **cache mémoire 5 min** par URL ③ **stale-on-error** (amont en panne → on sert la dernière réponse connue plutôt qu'un panneau vide) ④ timeout **20 s** (GDELT dépasse souvent 9 s en pointe). `/news` et la couche géo branchés dessus.
- **Script test-couches amélioré** : requête géo = celle EXACTE de l'app (l'ancienne 404 du test venait d'une requête différente), pause 6 s entre les 2 appels GDELT du script (anti-auto-429), détail par couche sur le flux lent (`earthquakes:… gdelt:… cyber:…`).
- Bilan du 1er run VPS : avions Paris **79** / USA **34** (fix bbox V4.018 **prouvé**), USGS/celestrak/abuse.ch/Overpass ✅.

### V4.018-dev — 2026-07-07 — 🐛 Avions « que sur la France » + script de test des couches
- **Cause racine trouvée par lecture de code** : `page.tsx` appelait `useDataPolling({...})` **sans capturer le handle retourné** → `setBBox` n'était JAMAIS appelé → le flux avions restait sur la bbox par défaut (France métropole), où que soit la carte. Le doc-comment de `liveData.ts` montrait le câblage attendu… qui n'existait nulle part.
- **Fix** : `OsirisMap` émet son emprise via un nouveau prop `onBoundsChange` (au `load` + à chaque `moveend`, **clampée ±180/±90** — sinon en vue monde/globe le serveur rejetait la bbox et retombait silencieusement sur la France) → `page.tsx` capture le handle et branche `live.setBBox`. Debounce déjà en place côté moteur (pas de spam réseau).
- **Limite amont assumée** : adsb.lol (`/v2/point`) plafonne à **250 NM de rayon** → on voit les avions autour du CENTRE de la vue, jamais le monde entier d'un coup. C'est la source gratuite qui veut ça.
- **`scripts/test-couches.sh`** (demande Cissou « il faut tester toutes ces couches ») : teste chaque couche SANS CLÉ en 2 passes — ① la source amont répond ? ② le staging la sert ? — avec verdict ✅/❌ par ligne. À lancer sur le VPS : `bash scripts/test-couches.sh`. (Impossible à exécuter depuis l'environnement Claude : réseau sortant bloqué par proxy.)
- **Rappel UX** : toutes les couches sont **éteintes par défaut** (économie réseau + respect des sources gratuites) → panneau « Couches » pour les allumer. « Rien ne s'affiche » ≠ « pas connecté ».

### V4.017-dev — 2026-07-07 — Page Clés API : scroll + PERSISTANCE des clés entre versions
- **Scroll réparé** sur `/cockpit/cles-api` : `html/body` sont en `overflow:hidden` (nécessaire à la carte plein écran) → la page porte désormais **son propre conteneur de scroll** (`h-screen overflow-y-auto`).
- **Clés saisies UNE fois, valables pour TOUTES les versions** (demande Cissou) : le compose staging charge **`env_file: /docker/osiris-v4/.env`** sur le service cockpit. Ce fichier vit sur le VPS, **hors git** (`.env` gitignoré) → il survit aux `git pull` et aux `up -d --build` de chaque palier. Création une seule fois : `cp .env.example .env` + renseigner. Priorité côté routes : clé saisie dans l'app (en-tête navigateur) → sinon cet env.
- **`.env.example` nettoyé** : mentions du nom de projet interdit retirées (→ `docs/PARITE-FONCTIONNELLE.md`) + note persistance ajoutée.
- Rappel : les clés saisies **dans l'app** (localStorage) survivent déjà aux redéploiements (elles vivent dans le navigateur) — l'env serveur couvre en plus tout navigateur/poste et les couches server-side.

### V4.016-dev — 2026-07-07 — Clés API : page dédiée (fini le panneau sur la carte)
- **Nouvelle page `/cockpit/cles-api`** (demande Cissou : « l'onglet API mérite une page dédiée ») : plein écran, **compteur « X / 13 clés configurées »**, note de sécurité, boutons retour Cockpit/Accueil, badge version. Route sous le basePath `/cockpit` (**jamais `/api/*`** — Traefik).
- **Refactor sans duplication** : le cœur du module (cartes de services par catégorie, statut ✔/○, champ masqué, Enregistrer/Effacer, lien + procédure) est extrait dans **`KeysManager.tsx`** — source unique consommée par la page ET l'ancien panneau.
- **`KeysPanel` (panneau flottant) ARCHIVÉ dormant** : plus référencé par l'UI, réactivable en 1 ligne (montage conservé dans `page.tsx`, `keysOpen` ne passe plus à true).
- **Tous les chemins pointent sur la page** : sidebar cockpit (« Clés API » → `Link /cles-api`), sidebar accueil (`goCockpitPage('/cockpit/cles-api')`), et compat des anciens liens `?panel=keys` (redirection).

### V4.015-dev — 2026-07-07 — Finitions sidebar (retours Cissou sur V4.014)
- **Version jamais tronquée** : le badge version passe **SOUS le mot OSIRIS** (layout colonne) sur l'accueil **et** le cockpit — l'image OSIRIS se réduit proprement (`max-width` + ratio préservé) au lieu d'être coupée. Le cockpit affiche à nouveau la version dans la marque (elle était reléguée au pied, invisible) ; retirée du pied (doublon).
- **Chevauchements réglés** : la barre de recherche du cockpit se décale de la largeur de la sidebar (`leftOffset={navW}` → `SearchBar`), fini le passage sous la barre.
- **Bouton flottant « ← Accueil » (desktop) ARCHIVÉ** : doublon du lien Accueil de la sidebar + chevauchait — code conservé en commentaire dans `page.tsx` (réactivable). La version mobile reste (pas de sidebar sur mobile).
- **Emojis retirés** des groupes Outils/Doc (accueil + cockpit), demande Cissou.
- **Prototype + Garde-fous déplacés dans le groupe Doc** (accueil), et le **groupe Doc ajouté à la sidebar cockpit** (`DOC_LINKS` repliable) — sidebar identique partout.

### V4.014-dev — 2026-07-07 — Réorg sidebar accueil (outils rapatriés + doc regroupée + version affichée)
- **Outils rapatriés sur l'accueil** (demande Cissou : « sur la carte c'est pas facile à utiliser ») : nouveau groupe repliable **« 🧰 Outils »** dans la sidebar de l'**accueil** (OSINT/Graphe/News/Clés API). Chaque bouton pointe vers **`/cockpit?panel=osint|graph|news|keys`** ; le cockpit lit `?panel` au montage (`useEffect` dans `src/app/page.tsx`) et **ouvre le panneau plein écran** — plus collé sur la carte. Helper `goCockpitPanel()` côté accueil (`app.js`). **1 seul code** (les outils restent en React dans le cockpit, aucune duplication).
- **Doc regroupée** : `Sources · Recettes · Glossaire` → 1 seul groupe repliable **« 📚 Doc »** dans la sidebar accueil (gain de place). `<details>`/`<summary>` natif, sans JS, + adaptation mobile. Prototype & Garde-fous restent séparés (pas de la doc).
- **Version visible sur l'accueil** : le badge sidebar affiche le palier (au lieu de « V4 » nu). ⚠️ L'accueil est un **repo séparé** (`claude-brain/projects/open-radar-fr`, FastAPI) qui ne peut pas importer ce `version.ts` → le numéro y est tenu **en lockstep manuel** (commentaire de rappel dans `index.html`). À bumper en même temps que ce fichier.
- Build cockpit vert + `tsc` OK + push branche V4. Accueil : commits brain sur la même branche.

### V4.013-dev — 2026-07-05 — Filtres d'attributs + Confort UI + Briefing IA
- **Filtres d'attributs 🎚️** : filtrer DANS une couche déjà affichée (≠ toggle d'activation). `lib/layerFilters.ts` (fonctions pures, tolérantes, jamais de throw) + `FilterPanel` (n'affiche que les couches actives). Avions : altitude/vitesse mini-maxi, militaires seuls, VIP seuls. Séismes : magnitude mini. Navires : vitesse + type. Géopolitique : plage de tonalité. Cyber : malware/pays (texte). Bouton « 🎚️ Filtres » + raccourci **T**.
- **Confort UI** : `shortcuts.ts` (raccourcis clavier **C**ouches/**R**ecentrer FR/**O**SINT/**T**ri-filtres/**V**isuel/**P**artage/Échap, ignorés dans les champs de saisie) · `viewPresets.ts` (presets de vue France/Paris/Occitanie/Méditerranée/Manche-Atlantique/Monde + presets custom localStorage) · `shareLink.ts` (lien partageable encodant couches+requête, copie presse-papier) · `ComfortBar` (Vues/Partager/?). **Barre d'échelle** MapLibre (charte OSIRIS).
- **⏸️ Briefing de situation IA — MIS DE CÔTÉ (demande Cissou 05/07)** : la brique a été construite (route `/analyze`, `analyzeClient.ts`, `BriefingPanel.tsx`) puis **débranchée de l'UI** avant déploiement. Les fichiers restent **dormants** dans le repo (règle « enrichir, jamais effacer ») ; le service `llm` a été retiré du module Clés API. Réactivation = remonter l'import + l'outil sidebar + le montage + `getBriefingContext` dans `page.tsx`.
- 3 agents Opus + intégration chef. Build + tsc OK.
- **Sidebar « toujours la même partout » (demande Cissou)** : la barre du cockpit était un clone qui dérivait de celle de l'accueil (« ça ressemble mais c'est pas pareil »). Corrigé en 2 temps sur la **source canonique** `claude-brain/projects/open-radar-fr/backend/open_radar/static/` :
  - CSS `.ck-*` ré-aligné **verbatim** (largeur 232 px, boutons Feedback/Déconnexion = `.nav-fb`/`.nav-logout`, foot à pulsation).
  - **Marque = MÊMES IMAGES que l'accueil** (le logo « ◎ » CSS ne suffisait pas) : `public/assets/logo-cut.png` (œil) + `public/assets/osiris-cut.png` (mot OSIRIS métallique), police **Orbitron** pour le badge version, servies sous BASE_PATH.
  - **Vraie transparence (pas de fond ajouté)** : la sidebar **flotte** en verre (position absolue) PAR-DESSUS la carte plein écran → la carte transparaît à travers le blur. (1re tentative avec une vidéo/image de fond = raccourci abandonné : inutile, la carte EST le fond.)
  - **Anti-chevauchement** : rail des couches (`LayerPanel`) + contrôles carte décalés dynamiquement de `navW` (0 ou 232) pour ne JAMAIS passer sous la barre. Version déplacée dans le pied (débordait de la barre).
  - **Repli/afficher** : bouton `«` dans la marque replie la sidebar (`navOpen`), bouton `☰` flottant la rouvre (calque du `.nav-collapse`/`.nav-reopen` de l'accueil). Contrôles/rail se recalent tout seuls.
  - **Règle anti-dérive** : source unique = l'accueil ; toute retouche s'y fait PUIS se re-synchronise ici (commentaire en tête du bloc `globals.css`).

### V4.012-dev — 2026-07-05 — Géopolitique + Cyber + News (sources gratuites)
- **Couche Géopolitique 🌍** : événements mondiaux géolocalisés via **GDELT** (gratuit sans clé), couleur par tonalité, popup + lien source. Toggle « Géopolitique ».
- **Couche Cyber 🛡️** : serveurs C2 malware via **abuse.ch Feodo** (gratuit), géoloc par centroïde pays, popup (IP/malware/pays). Veille défensive. Toggle « Cyber (C2) ».
- **Fil d'actualité** : `/news` (titres GDELT récents, filtre thème + langue FR/EN) + `NewsPanel`. Bouton « 📰 News » dans la sidebar.
- Les 2 couches carto sont dans le flux slow existant (pas de nouveau polling). 2 agents Opus + intégration chef. Build + tsc OK.
- ⏳ Sentinel imagery reporté (URL de tuiles EOX à vérifier avant branchement).

### V4.011-dev — 2026-07-05 — Graphe d'entités + module Clés API + sidebar refactor
- **Graphe d'entités** : route `/entity/expand` (orchestre les lookups OSINT en nœuds/liens) + `EntityGraphPanel` (graphe force-directed SVG maison, clic = étendre, drag/zoom/pan, style OSIRIS). Bouton « 🕸️ Graphe » dans la sidebar.
- **Module Clés API** : `apiKeys.ts` (stockage localStorage + `keyHeaders()`) + `KeysPanel` (13 services, lien + procédure + coût par service). **Fournir une clé dans l'app, sans redéployer.** Bouton « 🔑 Clés API » dans la sidebar.
- **Routes acceptent les clés user** : toutes les routes à clé lisent l'en-tête `x-osiris-key-<service>` (fallback env). `osintClient`/`liveData` attachent automatiquement les clés configurées.
- **Sidebar refactor** : extraite en `CockpitSidebar.tsx` **piloté par config** (`NAV_LINKS` + `TOOLS`) → facile à corriger. Section « Outils » (OSINT/Graphe/Clés API).
- 3 agents Opus + intégration chef. Build + tsc OK.

### V4.010-dev — 2026-07-05 — Boîte à outils OSINT (14 lookups)
- **Boîte à outils d'investigation** : 13 routes `/osint/*` — whois (RDAP), dns (DoH), ip (géoloc+ASN), cve, mac, certs (crt.sh), bgp, github, sanctions (OpenSanctions), phone (local) **tous gratuits sans clé** ; shodan/leaks/threats à clé (dégradation douce).
- **Panneau `OsintPanel`** : saisie + **détection auto du type de cible** (IP/domaine/email/CVE/pseudo/MAC/tél/ASN) → lance les bons outils en parallèle → fiches résultat FR style OSIRIS. Bouton « 🔍 OSINT » dans les contrôles carte.
- `.env.example` complété : `SHODAN_KEY`, `HIBP_KEY`, `ABUSEIPDB_KEY` (+ `GITHUB_TOKEN`/`OPENSANCTIONS_KEY` optionnels).
- 3 agents Opus + intégration chef. Routes sous `/osint/*` (jamais `/api`). Build + tsc OK.

### V4.005-dev — 2026-07-05 — Style « accueil », satellites, formes
- **Design aligné sur l'accueil** (décision Cissou : la landing est LA référence) : langage visuel repris (pills arrondies, cartes premium, `.glass-panel` enrichi, focus rings `--accent-soft`, hover décollé, états actifs `accent-soft`/`accent-line`). Utilitaires `.osiris-btn/-pill/-card/-row/-tag`.
- **Couche Satellites** : celestrak (TLE public sans clé) + calcul SGP4 (`satellite.js`), seed de satellites notables (ISS, Hubble, Terra, Landsat 8, NOAA 20, Starlink). Toggle FR « Satellites 🛰 ».
- **Formes public/perso + consentement** (fondation) : `src/lib/forms.ts` (flag `NEXT_PUBLIC_OSIRIS_FORM`, double verrou build+consentement révocable) + `src/components/ConsentModal.tsx` (modale FR, cadre ARPD). Prêt à gater les couches `form: 2` sensibles (câblage à l'ajout de la 1ère couche sensible).

### V4.009-dev — 2026-07-05 — Parité fonctionnelle OSINT (le gros livrable)
- **Routes tracées (trails)** : traînées avion/navire qui s'estompent avec l'âge (`lib/trails.ts`, layer line MapLibre).
- **Carte-fiche entité** au clic avion/VIP : **photo de l'appareil** (planespotters, gratuit) + détails FR + badge VIP + Centrer, style OSIRIS (`EntityCard.tsx` + `entityEnrich.ts`).
- **Lecteur de flux in-app** : clic webcam/CCTV → **vidéo en direct dans le cockpit** (HLS via hls.js + vidéo/MJPEG/iframe, `StreamViewer.tsx`).
- **Navires (AIS)** : couche + toggle (clé `AIS_REST_URL` requise, sinon vide).
- **Couches sensibles (forme 2)** : `military_bases` (Overpass, **sans clé**) + cctv/jamming/scanners/sigint/telegram (clés requises), section « Sensibles » visible en forme 2, **gating par modale de consentement** (ARPD).
- **Modes visuels** : CRT / NVG / thermique (overlay teinté OSIRIS, `VisualModeOverlay.tsx`) + bouton cycle.
- **Doc** : `docs/PARITE-FONCTIONNELLE.md` (parité complète + clés), `.env.example` complété (toutes les clés à payer listées).
- 5 agents Opus + intégration chef. Tout dégrade en douceur (aucune clé → couche vide, jamais d'erreur).

### V4.004-dev — 2026-07-05 — Avions fluides (interpolation)
- **Interpolation dead-reckoning** : entre 2 fetches avions (15 s), tick 2 s qui estime la position (cap + vitesse, 1 nœud = 0,5144 m/s) depuis la dernière position réelle → les aéronefs glissent au lieu de sauter (rendu radar live). Gated sur la couche avions.
- Fix déploiement (hors-code) : bug bouton « ← Accueil » → V3 causé par un **conteneur doublon** `osiris-v4-front` (projet `deploy/`) servant la racine avec du vieux code ; stoppé (`docker compose down`). Le cockpit vit sous `osiris-v4-cockpit` (`/cockpit`).

### V4.003-dev — 2026-07-05 — Vague multi-couches temps réel
- **Couches géophysiques** (endpoint lent `/live-feed/slow`, 120 s) :
  - **Séismes** — USGS GeoJSON (`all_day`), gratuit sans clé. Rayon/couleur par magnitude.
  - **Feux** — NASA FIRMS (VIIRS), nécessite `FIRMS_MAP_KEY` (gratuit) ; couche vide sinon.
  - **Volcans** — stub `[]` documenté (piste Smithsonian GVP), à brancher plus tard.
- **Tagging VIP avions** (endpoint rapide `/live-feed/fast`) : watchlist seed (forme 2, données publiques), champs `vip`/`vipName`/`category`/`vipColor`.
- **Système d'alertes** : toasts FR (seuil séisme ≥ 4.5, apparition VIP), anti-doublon, auto-expiration, clic → recentrage carte.
- **Dossier de zone** (clic droit) : Nominatim (reverse FR) + restcountries + Wikidata SPARQL (chef d'État P35 / chef gouvernement P122).
- **Versioning** : `src/lib/version.ts` + ce fichier + affichage header.
- **Documentation** : `docs/ARCHITECTURE.md` (guide agents + humains, procédure « ajouter une couche »).
- **Fix routing** : routes live déplacées de `/api/live-data/*` → **`/live-feed/*`** (Traefik strip `/api/*` vers le FastAPI en prod/staging → sinon 404). Même logique que `/proxy-tiles`.

### V4.002 — 2026-07-05 — Première couche temps réel (avions)
- Route `/live-feed/fast` : proxy adsb.lol (ADS-B public), bbox France défaut, SSRF-guardé, ETag/304, dégradation douce.
- Carte : couche symbole `live-aircraft` (icône orientée cap, popup FR altitude/vitesse/cap).
- `page.tsx` : `useDataPolling` gated (poll 15 s si couche ON) + toggle FR « Avions ✈ ».

### V4.001 — 2026-07-05 — Re-skin V3 + fondations
- Re-skin complet du cockpit vers la **charte OSIRIS V3** (bleu-cyan `#070a0f`/`#54bdde`, Space Grotesk / IBM Plex).
- Fondations clean-room (patterns externes (copyleft) ré-écrits) : `layerRegistry.ts` (registre déclaratif de couches), `store.ts` (store par-clé `useSyncExternalStore`), `liveData.ts` (polling 2-vitesses + ETag/304 + interpolation).
