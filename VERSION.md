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

### V4.003-dev — 2026-07-05 — Vague multi-couches temps réel
- **Couches géophysiques** (endpoint lent `/api/live-data/slow`, 120 s) :
  - **Séismes** — USGS GeoJSON (`all_day`), gratuit sans clé. Rayon/couleur par magnitude.
  - **Feux** — NASA FIRMS (VIIRS), nécessite `FIRMS_MAP_KEY` (gratuit) ; couche vide sinon.
  - **Volcans** — stub `[]` documenté (piste Smithsonian GVP), à brancher plus tard.
- **Tagging VIP avions** (endpoint rapide `/api/live-data/fast`) : watchlist seed (forme 2, données publiques), champs `vip`/`vipName`/`category`/`vipColor`.
- **Système d'alertes** : toasts FR (seuil séisme ≥ 4.5, apparition VIP), anti-doublon, auto-expiration, clic → recentrage carte.
- **Dossier de zone** (clic droit) : Nominatim (reverse FR) + restcountries + Wikidata SPARQL (chef d'État P35 / chef gouvernement P122).
- **Versioning** : `src/lib/version.ts` + ce fichier + affichage header.
- **Documentation** : `docs/ARCHITECTURE.md` (guide agents + humains, procédure « ajouter une couche »).

### V4.002 — 2026-07-05 — Première couche temps réel (avions)
- Route `/api/live-data/fast` : proxy adsb.lol (ADS-B public), bbox France défaut, SSRF-guardé, ETag/304, dégradation douce.
- Carte : couche symbole `live-aircraft` (icône orientée cap, popup FR altitude/vitesse/cap).
- `page.tsx` : `useDataPolling` gated (poll 15 s si couche ON) + toggle FR « Avions ✈ ».

### V4.001 — 2026-07-05 — Re-skin V3 + fondations
- Re-skin complet du cockpit vers la **charte OSIRIS V3** (bleu-cyan `#070a0f`/`#54bdde`, Space Grotesk / IBM Plex).
- Fondations clean-room (patterns ShadowBroker AGPL ré-écrits) : `layerRegistry.ts` (registre déclaratif de couches), `store.ts` (store par-clé `useSyncExternalStore`), `liveData.ts` (polling 2-vitesses + ETag/304 + interpolation).
