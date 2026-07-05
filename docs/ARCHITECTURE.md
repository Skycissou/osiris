# OSIRIS V4 — Architecture & Guide de contribution

> **Public visé** : tout contributeur — agent IA ou humain — qui reprend le cockpit.
> **But de ce document** : comprendre la structure en 10 min et savoir **où ajouter quoi** sans rien casser.
> **Règle d'or** : on **sur-documente**. Un fichier sans en-tête explicatif est un bug.

---

## 1. C'est quoi OSIRIS V4

Cockpit OSINT **défensif** (cadre ARPD : données publiques, veille, pas de ciblage). Deux « formes » prévues :

| Forme | Public | Couches |
|---|---|---|
| **① Tout public** | ARPD, grand public | Uniquement les couches `form: 1` (publiques : cartes IGN, avions, séismes…). |
| **② Perso enquêteur** | Cissou, usage pro | + couches `form: 2` sensibles (VIP, CCTV, jamming…), derrière opt-in/consentement. |

La forme active se pilote par un flag (`NEXT_PUBLIC_OSIRIS_FORM`, défaut `1`). Une couche `form: 2` n'est **jamais** servie en forme 1.

### Filiation & licence
- Base : fork **MIT** (`Skycissou/osiris`) → on peut bâtir librement.
- Inspiration features : **ShadowBroker** (`BigBodyCobain/Shadowbroker`, **AGPL-3.0**). ⚠️ **CLEAN-ROOM STRICT** : on reproduit des *patterns et valeurs*, on **ne copie AUCUN fichier ni bloc de code** AGPL. Spec de repro : `claude-brain/notes/recherche/shadowbroker-repro-spec.md`.

---

## 2. Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · MapLibre GL · framer-motion · lucide-react · Tailwind v4 (charte en CSS vars).
Backend données : **routes Next** sous `src/app/live-feed/...` (⚠️ **PAS sous `/api`** : en prod/staging, Traefik strip `/api/*` vers le FastAPI V3 — une route Next sous `/api` serait interceptée). Elles proxifient des sources publiques (SSRF-guardé). La recherche FR (`/search`) et le login sont servis par le **FastAPI V3** (hors de ce repo) en prod.

---

## 3. Carte du code (`src/`)

```
src/
├── app/
│   ├── page.tsx            ← ORCHESTRATEUR : état global, toggles, montage des panneaux
│   ├── layout.tsx          ← polices + métadonnées
│   ├── globals.css         ← CHARTE V3 (toutes les couleurs/polices en :root vars)
│   ├── proxy-tiles/route.ts← proxy des tuiles de fond (CARTO) — PAS sous /api
│   ├── api/health/route.ts
│   └── live-feed/          ← routes données live — PAS sous /api (Traefik strip /api→FastAPI)
│       ├── fast/route.ts   ← flux RAPIDE 15 s (avions + VIP)
│       └── slow/route.ts   ← flux LENT 120 s (séismes, feux, volcans)
├── components/
│   ├── OsirisMap.tsx        ← CHÂSSIS carto MapLibre : toutes les couches se dessinent ici
│   ├── LayerPanel.tsx       ← panneau couches de résultats (recherche FR)
│   ├── SearchBar.tsx / ResultsPanel.tsx / LoginGate.tsx / ErrorBoundary.tsx
│   ├── AlertToasts.tsx      ← pile de toasts d'alerte (temps réel)
│   └── RegionDossierPanel.tsx ← dossier de zone (clic droit)
└── lib/
    ├── version.ts          ← SOURCE UNIQUE de la version (voir VERSION.md)
    ├── api.ts              ← client recherche FR + helpers carte + BASE_PATH
    ├── layerRegistry.ts    ← REGISTRE DÉCLARATIF des couches (form 1/2, sources, couleurs)
    ├── store.ts            ← store temps réel par-clé (useSyncExternalStore)
    ├── liveData.ts         ← moteur de polling 2-vitesses + ETag/304 + interpolation
    ├── alerts.ts           ← hook de génération des alertes toasts
    ├── regionDossier.ts    ← hook du dossier de zone
    └── ssrf-guard.ts       ← garde SSRF (obligatoire pour tout fetch externe)
```

---

## 4. Flux de données temps réel (le tuyau)

```
Source publique (adsb.lol, USGS…)
      │  fetch SSRF-guardé
      ▼
Route Next  /live-feed/{fast|slow}   ── renvoie { <couche>: [...], ... } + ETag
      │  polling (liveData.ts : 15 s / 120 s, If-None-Match → 304 = no-op)
      ▼
Store par-clé  (store.ts : mergeData → notifie SEULEMENT les clés changées)
      │  useDataKey('aircraft'), useDataKey('earthquakes')…  (dans page.tsx)
      ▼
Props → OsirisMap.tsx  ── construit la FeatureCollection + affiche/masque selon le toggle
```

Points clés :
- **Le body d'une route = objet clé→tableau** (`{ aircraft: [...] }`). `mergeData` merge ces clés dans le store. Une clé = une couche.
- **Polling gated** : il ne tourne que si au moins une couche live est active (économie réseau + respect des sources gratuites).
- **ETag/304** : si la source n'a pas changé, aucun re-render.
- **Interpolation** (`liveData.ts` → `deadReckon`) : mouvement fluide des mobiles entre 2 fetches.

---

## 5. ➕ RECETTE : ajouter une nouvelle couche temps réel

Exemple : ajouter les **navires**.

1. **Source & route** — dans `src/app/live-feed/fast/route.ts` (mobile → rapide) ou `slow` (statique → lent) : fetch la source publique (via `safeFetch` SSRF), normalise en items `{ id, lat, lng, ... }`, ajoute la clé au body : `{ aircraft, ships }`.
2. **Registre** — déclare la couche dans `src/lib/layerRegistry.ts` (`LayerDef` : `id`, `name` FR, `source`, `form`, `color` charte V3, `sensitive` si besoin).
3. **Carte** — dans `OsirisMap.tsx` : ajoute une prop `ships?: ShipPoint[]`, crée `source` + `layer` MapLibre (copie le bloc `live-aircraft`), et un `useEffect` de rendu (copie celui des avions) piloté par `activeLayers.live_ships`.
4. **Orchestrateur** — dans `page.tsx` : `const ships = useDataKey('ships')`, passe `ships={ships}` à `<OsirisMap>`, ajoute le toggle FR dans le menu COUCHES → section « Temps réel », et ajoute `live_ships` à `DEFAULT_LAYERS`.
5. **Version + doc** — incrémente le palier (§ VERSION.md), documente.

> Tout se fait **par imitation du pattern avions** déjà en place. Une couche = ~1 route + 1 entrée registre + 1 bloc carte + 1 toggle.

---

## 6. 🎨 Charte graphique (NON négociable)

Toutes les couleurs/polices vivent dans `globals.css` (`:root`). **Ne jamais coder une couleur en dur** hors charte. Réutiliser les vars :

| Usage | Var / hex |
|---|---|
| Fond | `--bg` `#070a0f` |
| Panneau (glass) | `--panel` `#0d121b`, classe `.glass-panel` |
| Accent principal | `--accent` `#54bdde` |
| Accent clair | `--accent-bright` `#9bdcf0` |
| Sévérité critique / élevé / ok | `--red #db6f78` / `--amber #d6a445` / `--green #5bc78d` |
| VIP / autre | `--violet #9a8cef` |
| Polices | display `Space Grotesk` · UI `IBM Plex Sans` · mono `IBM Plex Mono` |

**Tout le texte UI est en FRANÇAIS** (ShadowBroker est en anglais → OSIRIS 100 % FR).

---

## 7. Règles de contribution (agents & humains)

1. **Clean-room** vis-à-vis de ShadowBroker (AGPL) : jamais de copie de fichier/bloc.
2. **Fetch externe** : toujours via `safeFetch` (SSRF), timeout, dégradation douce (renvoyer une liste vide plutôt que planter).
3. **Français partout** + **sur-documentation** (en-tête de fichier obligatoire).
4. **Charte V3** pour tout nouveau visuel.
5. **Couches `form: 2`** : jamais actives par défaut, jamais servies en forme 1.
6. **Versioning** : chaque chantier livré incrémente le palier (voir VERSION.md).
7. **Travail multi-agents** : un agent = un périmètre de fichiers **disjoint** (les fichiers partagés — `page.tsx`, `OsirisMap.tsx` — sont intégrés par le chef, pas en parallèle).
8. **Vérif avant push** : `npx tsc --noEmit` **et** `npm run build` doivent passer.

---

## 8. Déploiement (rappel)

Deux modes de service (via `NEXT_PUBLIC_BASE_PATH`) :
- **Staging** = servi à la **racine** (`NEXT_PUBLIC_BASE_PATH=""`). Traefik : `/`→front Next, `/api/*`→FastAPI V3. C'est pour ça que les routes live sont sous **`/live-feed/*`** (jamais `/api`), sinon elles partiraient au FastAPI (404).
- **Prod sous /cockpit** = `NEXT_PUBLIC_BASE_PATH="/cockpit"`. Tout `/cockpit/*` (dont `/cockpit/live-feed/*` et `/cockpit/proxy-tiles`) → Next ; `/api/*` racine → FastAPI V3.

Le client (`liveData.ts`, `api.ts`) préfixe automatiquement le basePath. Détails : `DOCKER.md`, `deploy/README-staging.md`.

---
*Doc maintenue à chaque chantier. Si tu ajoutes une brique, ajoute son entrée ici. Un projet non documenté est un projet perdu.*
