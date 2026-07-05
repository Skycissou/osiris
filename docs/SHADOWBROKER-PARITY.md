# OSIRIS V4 — Parité ShadowBroker & clés d'environnement

> **À quoi sert ce document ?**
> C'est LA référence pour savoir, feature par feature, où en est OSIRIS V4 par
> rapport au cockpit d'inspiration (ShadowBroker), quelle **source de données**
> alimente chaque couche, et quelle **clé d'API** brancher pour l'activer.
>
> Tenu à jour comme un document **vivant** : dès qu'une couche change de statut
> ou qu'une clé est branchée, on met à jour le tableau correspondant.

> **Clean-room** : OSIRIS reprend des *idées* (registre de couches, skins
> visuels, fiches entité). **Aucune ligne de code n'a été copiée.** Charte et
> cadre défensif sont propres à OSIRIS. Licence du repo : MIT.

---

## 1. Légende des statuts

| Statut | Signification |
|---|---|
| ✅ **fait** | Couche réelle, données live, marche sans clé (ou clé déjà en place). |
| 🔑 **prêt — clé requise** | Code prêt : il suffit de renseigner la variable d'env pour l'activer. Sans clé ⇒ couche vide, **jamais** d'erreur. |
| 🧩 **scaffold** | Structure déclarée (registre, types) mais brancher la source reste à faire. |
| ⏳ **différé** | Volontairement repoussé (hors périmètre du sprint courant). |

**Formes d'usage** (voir §4) : `F1` = tout-public · `F2` = perso/enquêteur (opt-in + consentement).

---

## 2. Tableau de parité fonctionnelle

| Feature (ShadowBroker → OSIRIS) | Statut | Forme | Source de données | Variable d'env |
|---|---|---|---|---|
| **Avions (ADS-B temps réel)** | ✅ fait | F1 | adsb.lol (`/live-feed/fast`) | — (API publique, sans clé) |
| **VIP (watchlist aéronefs)** | ✅ fait | F1 | adsb.lol + seed `WATCHLIST_VIP` (tag hex ICAO24) | — (seed interne, extensible) |
| **Navires (AIS)** | 🧩 scaffold | F1 | AIS public (temps réel) | `AISSTREAM_KEY` |
| **Satellites (TLE + SGP4)** | ✅ fait | F1 | Celestrak (TLE) + `satellite.js` (`/live-feed/slow`) | — (public, sans clé) |
| **Séismes** | ✅ fait | F1 | USGS feed (`/live-feed/slow`) | — (public, sans clé) |
| **Feux de forêt** | 🔑 prêt — clé requise | F1 | NASA FIRMS (`/live-feed/slow`) | `FIRMS_MAP_KEY` |
| **Volcans** | 🧩 scaffold | F1 | Smithsonian GVP (bulletin hebdo, à normaliser) | — (pas de JSON no-key stable) |
| **CCTV (caméras)** | 🧩 scaffold | **F2** | OSINT restreint | `CCTV_SOURCE_KEY` |
| **Brouillage GPS (jamming)** | 🧩 scaffold | **F2** | OSINT restreint (type gpsjam) | `GPSJAM_KEY` |
| **Scanners radio** | 🧩 scaffold | **F2** | OSINT restreint | `SCANNER_KEY` |
| **Maillage SIGINT** | 🧩 scaffold | **F2** | OSINT restreint | `SIGINT_KEY` |
| **Bases / emprises militaires** | 🧩 scaffold | **F2** | OSINT restreint | — (dataset statique à brancher) |
| **Frontline (ligne de front)** | ⏳ différé | **F2** | OSINT restreint | `FRONTLINE_KEY` |
| **Telegram (flux OSINT)** | ⏳ différé | **F2** | Canaux Telegram OSINT | `TELEGRAM_OSINT_KEY` |
| **Trails / routes (traces)** | 🧩 scaffold | F1 | Dérivé des positions live (historisation) | — |
| **Fiches entité + images** | 🧩 scaffold | F1 | Agrégat interne (+ vignettes planespotters) | — (voir CSP §5) |
| **Alertes (toasts)** | ✅ fait | F1 | Interne (`src/lib/alerts.ts` + `AlertToasts`) | — |
| **Dossier de zone** | ✅ fait | F1 | Interne (`RegionDossierPanel` + `regionDossier.ts`) | — |
| **Modes visuels (skins)** | ✅ fait | F1 | Interne (`visualModes.ts` + `VisualModeOverlay`) | — |
| **Time machine (rejeu temporel)** | ⏳ différé | F1 | Historisation locale des flux | — |
| **Graphe / téléonomie bayésienne (GT)** | ⏳ différé | F1 | Moteur interne (à concevoir) | — |

> **Note importante** : les variables des couches 🧩/⏳ **ne sont PAS encore
> lues dans le code** (seule `FIRMS_MAP_KEY` l'est aujourd'hui, dans
> `src/app/live-feed/slow/route.ts`). Elles sont **réservées** ici pour cadrer
> l'intégration à venir : quand on branche la couche, on lit `process.env.<CLÉ>`
> dans la route `/live-feed/*` correspondante, avec **dégradation douce** si
> absente.

---

## 3. Variables d'environnement — liste complète

### 3.1 Clés réellement lues aujourd'hui

| Variable | Rôle | Où l'obtenir | Coût |
|---|---|---|---|
| `FIRMS_MAP_KEY` | Active la couche **Feux** (NASA FIRMS). Absente ⇒ couche vide, pas d'appel API. | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | Gratuit |
| `NEXT_PUBLIC_OSIRIS_FORM` | Sélectionne la **forme** d'usage exposée (`1` tout-public / `2` enquêteur). | Config déploiement | — |
| `NEXT_PUBLIC_BASE_PATH` | Préfixe de route de l'app (ex. `/cockpit`). Doit matcher la route Traefik. | Config build (cf. `DEPLOY.md`) | — |
| `NEXT_PUBLIC_API_BASE` | Base des appels API côté client (souvent `""` = même origine). | Config build (cf. `DEPLOY.md`) | — |

> `NEXT_PUBLIC_*` = exposées au **navigateur** (injectées au build). Ne JAMAIS
> y mettre de secret. Les clés serveur (ci-dessous) restent **hors** du client.

### 3.2 Clés réservées (couches à brancher — pas encore lues)

| Variable | Couche cible | Où l'obtenir | Coût |
|---|---|---|---|
| `AISSTREAM_KEY` | Navires (AIS temps réel) | https://aisstream.io | Gratuit (quota) |
| `CCTV_SOURCE_KEY` | Caméras CCTV (F2) | Source OSINT restreinte (au cas par cas) | Variable |
| `GPSJAM_KEY` | Brouillage GPS (F2) | Source type gpsjam / dérivé ADS-B | Variable |
| `SCANNER_KEY` | Scanners radio (F2) | Agrégateur de flux radio | Variable |
| `SIGINT_KEY` | Maillage SIGINT (F2) | Source OSINT restreinte | Variable |
| `FRONTLINE_KEY` | Ligne de front (F2, différé) | Source OSINT géopolitique | Variable |
| `TELEGRAM_OSINT_KEY` | Flux Telegram OSINT (F2, différé) | Bot / API Telegram | Gratuit (compte) |

> **Convention d'intégration** : une clé serveur se lit UNIQUEMENT dans une
> route `src/app/live-feed/*/route.ts`, jamais côté client. Modèle à suivre
> (calqué sur FIRMS) :
> ```ts
> const key = process.env.AISSTREAM_KEY;
> if (!key) return []; // dégradation douce — couche vide, pas d'erreur
> ```

---

## 4. Cadre défensif ARPD

- **Deux formes, une règle** :
  - **Forme 1** — tout-public : couches OSINT ouvertes, sans consentement.
  - **Forme 2** — perso / enquêteur : couches `sensitive: true`, **opt-in**,
    derrière **consentement explicite** (voir `ConsentModal`).
- Les couches sensibles (CCTV, jamming, scanners, SIGINT, bases, frontline,
  Telegram) sont **déclarées** dans `src/lib/layerRegistry.ts` mais **jamais
  servies en forme 1**.
- **Aucun ciblage de personne.** On annote des identifiants **déjà publics**
  (ex. hex ICAO24 d'un appareil diffusé sur 1090 MHz), pas des individus.
- Usage strictement **veille / situationnel défensif**, esprit ARPD : seulement
  ce que n'importe qui capte déjà par des moyens publics et légaux.
- Le choix de la forme exposée se fait via `NEXT_PUBLIC_OSIRIS_FORM`.

---

## 5. Anti-bug / pièges (à lire avant de coder ou déployer)

| Piège | Règle à respecter |
|---|---|
| **Routes API** | Les endpoints live sont sous **`/live-feed/*`**, JAMAIS `/api/*`. Respecter ce préfixe côté client (`src/lib/liveData.ts`). |
| **Dégradation douce** | Toute source morte ou clé absente ⇒ couche **vide**, jamais de `500`. Modèle FIRMS : pas de clé ⇒ pas d'appel ⇒ `[]`. |
| **Déploiement** | **`git pull` AVANT rebuild** — sinon on reconstruit du vieux code (cf. `DEPLOY.md`, erreur classique). |
| **Base path** | `NEXT_PUBLIC_BASE_PATH` doit matcher la route Traefik (`/cockpit`). Un mismatch casse les assets et les fetch. |
| **CSP images** | Les vignettes d'aéronefs (planespotters) exigent d'autoriser leur hôte dans la CSP `img-src`. Sinon images bloquées silencieusement. |
| **Gating du polling** | Ne poller que les couches **actives** et à l'intervalle prévu (fast vs slow). Éviter de marteler les API publiques. |
| **Secrets** | Les clés serveur (`*_KEY` sans `NEXT_PUBLIC_`) ne doivent JAMAIS fuiter côté client. Lecture uniquement en route serveur. |
| **Modes visuels** | Overlay purement décoratif (`pointer-events: none`) — ne doit rien capter ni altérer les données. Style **scopé** au composant, pas dans `globals.css`. |

---

## 6. Fichiers de référence

| Sujet | Fichier |
|---|---|
| Registre déclaratif des couches | `src/lib/layerRegistry.ts` |
| Route flux rapide (avions + VIP) | `src/app/live-feed/fast/route.ts` |
| Route flux lent (séismes, feux, volcans, satellites) | `src/app/live-feed/slow/route.ts` |
| Modes visuels (catalogue) | `src/lib/visualModes.ts` |
| Modes visuels (overlay) | `src/components/VisualModeOverlay.tsx` |
| Alertes / toasts | `src/lib/alerts.ts` · `src/components/AlertToasts.tsx` |
| Dossier de zone | `src/lib/regionDossier.ts` · `src/components/RegionDossierPanel.tsx` |
| Consentement (forme 2) | `src/components/ConsentModal.tsx` |
| Déploiement staging | `DEPLOY.md` |

---

*Document vivant — mettre à jour le tableau §2 et les listes §3 à chaque
changement de statut ou branchement de clé.*
