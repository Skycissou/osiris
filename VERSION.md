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
