# OSIRIS V4 — Procédure de déploiement (staging)

> ## 🏗️ ÉMANCIPATION — bascule host entier (V4.086+, à faire une fois par Hermès sous GO Cissou)
>
> **But** : `osiris-v4.cissouhub.cloud` servi ENTIÈREMENT par l'app Next V4 (racine `/` = accueil, `/cockpit` = carte). Compose canonique = **`docker-compose.v4.yml`** (racine du repo). Tant que cette bascule n'est pas faite, la procédure « MAJ classique » plus bas (compose combiné) reste la bonne.
>
> **Ordre SÉCURISÉ (rollback jusqu'à ④) :**
> ```bash
> # ① code à jour (build context)
> cd /docker/osiris-v4 && git fetch origin && git reset --hard origin/master && git log --oneline -1
> # ② lever le compose autonome (priorité Traefik 200 > staging → prend tout le host sans rien casser)
> docker compose -f /docker/osiris-v4/docker-compose.v4.yml up -d --build
> # ③ VÉRIFIER (curls §Vérif ci-dessous + plan brain §6) — TOUS doivent passer
> # ④ seulement si ✅ : retirer le rôle V4 (racine + /cockpit) du compose combiné + MAJ registre
> #    ↩︎ ROLLBACK avant ④ : docker compose -f docker-compose.v4.yml down (l'ancien reprend par priorité)
> ```
> ⚠️ **Avant ②, Hermès réconcilie `docker-compose.v4.yml`** avec le service `osiris-v4-cockpit` actuel : reporter env runtime + volume de données (persistance alertes/clés — volume `open-radar-fr_osiris_v4stg_uitel`) ; ne changer QUE les labels Traefik (host entier). `osiris-pg` reste en commentaire (Lot C).
>
> **Curls de vérif bascule** (Claude Code ne peut pas — HTTP 000) :
> ```bash
> curl -s -o /dev/null -w "racine:%{http_code}\n" https://osiris-v4.cissouhub.cloud/          # 200 = accueil V4
> curl -s -o /dev/null -w "css:%{http_code}\n"    https://osiris-v4.cissouhub.cloud/landing/style.css  # 200 (sinon P2)
> curl -s -o /dev/null -w "cockpit:%{http_code}\n" https://osiris-v4.cissouhub.cloud/cockpit   # 200
> curl -s -o /dev/null -w "diag:%{http_code}\n"   https://osiris-v4.cissouhub.cloud/cockpit/live-feed/diag  # 200 (P3 OK)
> curl -s -o /dev/null -w "login:%{http_code}\n"  https://osiris-v4.cissouhub.cloud/login       # 200 (design visible)
> curl -s -o /dev/null -w "ingest:%{http_code}\n" -X POST https://osiris-v4.cissouhub.cloud/cockpit/alerts/ingest  # 401
> curl -s -o /dev/null -w "V3:%{http_code}\n"     https://osiris.cissouhub.cloud/               # inchangée
> ```
> Contrôle manuel clef : depuis le cockpit, cliquer « Accueil » → accueil V4, **jamais** un écran d'identifiants.

---

## Procédure classique (compose combiné — valable AVANT la bascule Émancipation)

> **Cible** : `https://osiris-v4.cissouhub.cloud/cockpit` (cockpit V4) · la racine `/` = landing (open-radar).
> **Conteneur du cockpit** : `osiris-v4-cockpit` (projet compose `open-radar-fr`).
> **⚠️ ERREUR CLASSIQUE À NE JAMAIS REFAIRE** : rebuild SANS `git pull` du code source → on reconstruit du **vieux code**. Le `build context` est `/docker/osiris-v4` : il DOIT être à jour AVANT le rebuild.

## Topologie (vérifiée 2026-07-05)
| Élément | Valeur |
|---|---|
| Domaine | `osiris-v4.cissouhub.cloud` |
| Cockpit | route Traefik `PathPrefix(/cockpit)` → conteneur `osiris-v4-cockpit` |
| Racine `/` | landing (conteneur `osiris-v3-staging`, open-radar) |
| Compose | `/docker/osiris-v3-staging/projects/open-radar-fr/docker-compose.staging-combined.yml` |
| Build context du cockpit | **`/docker/osiris-v4`** (clone du repo osiris) |
| Build args | `NEXT_PUBLIC_BASE_PATH=/cockpit` · `NEXT_PUBLIC_API_BASE=""` |
| ⚠️ Doublon à garder MORT | `osiris-v4-front` (projet `deploy/`) — servait un vieux cockpit à la racine, `down` le 05/07 |

## Procédure de MAJ (LA bonne, dans l'ordre)

```bash
# 1. METTRE À JOUR LE CODE SOURCE (obligatoire — sinon rebuild = vieux code)
cd /docker/osiris-v4
git fetch origin
git reset --hard origin/master
git log --oneline -1          # vérifier le commit attendu

# 2. (garde-fou) s'assurer que le doublon est bien arrêté
cd /docker/osiris-v4/deploy
docker compose -f docker-compose.staging.yml down 2>/dev/null || true

# 3. Rebuild SANS cache + relance UNIQUEMENT le cockpit
cd /docker/osiris-v3-staging/projects/open-radar-fr
docker compose -f docker-compose.staging-combined.yml build --no-cache osiris-v4-cockpit
docker compose -f docker-compose.staging-combined.yml up -d --no-deps osiris-v4-cockpit
```

## Vérification (preuve, pas « c'est fait »)

```bash
curl -s https://osiris-v4.cissouhub.cloud/cockpit/live-feed/slow | head -c 60   # → {"earthquakes":[...
```
Navigateur (Ctrl+Shift+R) : le header affiche la **version attendue** (`src/lib/version.ts` → `OSIRIS_VERSION`). Si la version ne change pas → l'étape 1 (git pull) n'a pas été faite.

## Pièges connus
- **`--no-cache` obligatoire** : sans lui, Docker ressert des couches périmées.
- **Routes live sous `/live-feed/*`**, jamais `/api/*` (Traefik strip `/api` → FastAPI).
- **Header version = tell** : la version affichée doit matcher le dernier commit déployé.
