# OSIRIS V4 — Procédure de déploiement

> ## 🆔 ÉTAT : HOST ÉMANCIPÉ (depuis le 13/07)
> `osiris-v4.cissouhub.cloud` est servi **ENTIÈREMENT** par le conteneur **`osiris-v4`** (compose autonome **`docker-compose.v4.yml`**, racine du repo, label Traefik `Host(osiris-v4.cissouhub.cloud)` **priorité 200** → il prend racine `/`, `/cockpit`, tout).
> ⛔ L'ancienne procédure « combiné-staging » (`osiris-v4-cockpit` dans `docker-compose.staging-combined.yml`) est **PÉRIMÉE** : Traefik ne route PLUS vers ce conteneur → le rebuilder ne change RIEN (leçon 13/07, plusieurs heures perdues). Elle est conservée en bas **pour mémoire uniquement**.

---

## 🚀 Procédure COURANTE (compose autonome) — 4 étapes DANS L'ORDRE

```bash
# 1. Code à jour (build context = /docker/osiris-v4) — sinon rebuild de VIEUX code
cd /docker/osiris-v4
git fetch origin && git reset --hard origin/master && git log --oneline -1   # vérifier le commit attendu

# 2. Rebuild SANS cache — ⚠️ `--build` seul NE force PAS le rebuild (voir Pièges)
docker compose -f docker-compose.v4.yml build --no-cache

# 3. Relance en FORÇANT le remplacement du conteneur
docker compose -f docker-compose.v4.yml up -d --force-recreate

# 4. Vérif (attendre le boot ~10 s, sinon Bad Gateway)
curl -s https://osiris-v4.cissouhub.cloud/cockpit/version   # → {"version":"V4.xxx-dev"} = version de src/lib/version.ts
```

Topologie : build context `.` = `/docker/osiris-v4` · service `osiris-v4` · `container_name: osiris-v4` · volume `open-radar-fr_osiris_v4stg_uitel` → `/app/data` (alertes, arpd-state, coffre clés — persistant, root-owned : `chown -R 1001:1001` ponctuel si volume neuf) · build args `NEXT_PUBLIC_BASE_PATH=/cockpit` · `NEXT_PUBLIC_API_BASE=""`.

## ✅ Vérification (preuve, pas « c'est fait »)

```bash
curl -s -o /dev/null -w "racine:%{http_code}\n"  https://osiris-v4.cissouhub.cloud/            # 200 accueil V4
curl -s -o /dev/null -w "cockpit:%{http_code}\n" https://osiris-v4.cissouhub.cloud/cockpit     # 200
curl -s https://osiris-v4.cissouhub.cloud/cockpit/version                                       # version attendue
curl -s -o /dev/null -w "diag:%{http_code}\n"    https://osiris-v4.cissouhub.cloud/cockpit/live-feed/diag  # 200
curl -s -o /dev/null -w "V3:%{http_code}\n"      https://osiris.cissouhub.cloud/                # V3 prod INCHANGÉE
```
Navigateur (Ctrl+Shift+R) : le header affiche la **version attendue**. Si elle ne change pas → l'étape 1 (git reset) ou 2 (`--no-cache`) n'a pas été faite.

## ⚠️ Pièges connus (tous vus en prod le 13/07)

- **`--build` ne suffit PAS** : `docker compose up -d --build` a resservi des layers `CACHED` (`COPY . .` + `npm run build`) → **vieux code déployé**. → `build --no-cache` obligatoire.
- **« Started » ≠ « Recreated »** : après un rebuild, `up -d` peut relancer l'ANCIEN conteneur (vieille image) sans le recréer. → `--force-recreate`.
- **`Bad Gateway`** au curl = conteneur pas encore prêt (tapé trop tôt après le `Started`). → attendre ~10 s / poller.
- **Ne pas rebuilder le combiné-staging** (`osiris-v4-cockpit`) : Traefik ne route plus vers lui (priorité `osiris-v4`=200) → aucun effet visible.
- **Routes live sous `/cockpit/live-feed/*`**, jamais `/api/*` (Traefik strip `/api` → FastAPI V3).

## 🔁 Rollback

```bash
docker compose -f docker-compose.v4.yml down       # coupe le conteneur autonome
# puis redéployer un commit antérieur (git reset --hard <sha> à l'étape 1) et rebuild --no-cache.
```
Backups code VPS (déjà pris) : `/docker/osiris-v4.backup-*`, `/docker/osiris-v4/.deploy-backups/code-*.tar.gz`.

---

## 🗄️ HISTORIQUE — procédure « combiné-staging » (PÉRIMÉE depuis l'Émancipation 13/07)

> ⛔ **NE PLUS UTILISER.** Conservée pour comprendre les anciens handoffs/notes. Avant la bascule, le cockpit V4 était un conteneur `osiris-v4-cockpit` greffé sur le compose combiné de l'open-radar, et l'accueil venait du conteneur V3-staging. Depuis l'Émancipation, tout est servi par `osiris-v4` (voir haut de page).

Ancienne topologie : cockpit = route Traefik `PathPrefix(/cockpit)` → `osiris-v4-cockpit` (build context `/docker/osiris-v4`, compose `/docker/osiris-v3-staging/projects/open-radar-fr/docker-compose.staging-combined.yml`) · racine `/` = landing servie par `osiris-v3-staging`.

Ancienne procédure (3 étapes) :
```bash
cd /docker/osiris-v4 && git fetch origin && git reset --hard origin/master        # 1. code à jour
cd /docker/osiris-v4/deploy && docker compose -f docker-compose.staging.yml down   # 2. garde-fou anti-doublon (si présent)
cd /docker/osiris-v3-staging/projects/open-radar-fr \
  && docker compose -f docker-compose.staging-combined.yml build --no-cache osiris-v4-cockpit \
  && docker compose -f docker-compose.staging-combined.yml up -d --no-deps osiris-v4-cockpit   # 3. rebuild + up
```
