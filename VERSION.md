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

### V4.013-dev — 2026-07-05 — Filtres d'attributs + Confort UI + Briefing IA
- **Filtres d'attributs 🎚️** : filtrer DANS une couche déjà affichée (≠ toggle d'activation). `lib/layerFilters.ts` (fonctions pures, tolérantes, jamais de throw) + `FilterPanel` (n'affiche que les couches actives). Avions : altitude/vitesse mini-maxi, militaires seuls, VIP seuls. Séismes : magnitude mini. Navires : vitesse + type. Géopolitique : plage de tonalité. Cyber : malware/pays (texte). Bouton « 🎚️ Filtres » + raccourci **T**.
- **Confort UI** : `shortcuts.ts` (raccourcis clavier **C**ouches/**R**ecentrer FR/**O**SINT/**T**ri-filtres/**V**isuel/**P**artage/Échap, ignorés dans les champs de saisie) · `viewPresets.ts` (presets de vue France/Paris/Occitanie/Méditerranée/Manche-Atlantique/Monde + presets custom localStorage) · `shareLink.ts` (lien partageable encodant couches+requête, copie presse-papier) · `ComfortBar` (Vues/Partager/?). **Barre d'échelle** MapLibre (charte OSIRIS).
- **Briefing de situation IA 🧠** : route `/analyze` (POST, hors `/api`) → briefing FR du contexte carte (couches actives + décomptes + zone) via LLM. Clé user `x-osiris-key-llm` (fallback env `LLM_API_KEY`), fournisseur OpenRouter/OpenAI (`LLM_PROVIDER`), modèle `LLM_MODEL`. **Dégradation douce** : sans clé → briefing basique déterministe (jamais de 500). `BriefingPanel` + bouton « 🧠 Briefing IA » sidebar. Cadre défensif ARPD dans le prompt (données publiques, aucun ciblage).
- Service `llm` ajouté au registre `apiKeys` (documenté dans le module Clés API). 3 agents Opus + intégration chef. Build + tsc OK.

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
