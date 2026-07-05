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

### V4.005-dev — 2026-07-05 — Style « accueil », satellites, formes
- **Design aligné sur l'accueil** (décision Cissou : la landing est LA référence) : langage visuel repris (pills arrondies, cartes premium, `.glass-panel` enrichi, focus rings `--accent-soft`, hover décollé, états actifs `accent-soft`/`accent-line`). Utilitaires `.osiris-btn/-pill/-card/-row/-tag`.
- **Couche Satellites** : celestrak (TLE public sans clé) + calcul SGP4 (`satellite.js`), seed de satellites notables (ISS, Hubble, Terra, Landsat 8, NOAA 20, Starlink). Toggle FR « Satellites 🛰 ».
- **Formes public/perso + consentement** (fondation) : `src/lib/forms.ts` (flag `NEXT_PUBLIC_OSIRIS_FORM`, double verrou build+consentement révocable) + `src/components/ConsentModal.tsx` (modale FR, cadre ARPD). Prêt à gater les couches `form: 2` sensibles (câblage à l'ajout de la 1ère couche sensible).

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
- Fondations clean-room (patterns ShadowBroker AGPL ré-écrits) : `layerRegistry.ts` (registre déclaratif de couches), `store.ts` (store par-clé `useSyncExternalStore`), `liveData.ts` (polling 2-vitesses + ETag/304 + interpolation).
