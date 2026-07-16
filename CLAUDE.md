# CLAUDE.md — repo osiris (cockpit V4)

> Lu automatiquement par Claude Code à chaque session. NE PAS SUPPRIMER.

> ## 🆔 DEUX ENTITÉS DISTINCTES — lis ça avant tout
>
> | | 🟢 **OSIRIS V3 — PROD (gelée)** | 🚀 **OSIRIS V4 — DEV (l'avenir)** |
> |---|---|---|
> | Rôle | Prod stable des 3 testeurs · **maintenance only** | **Seule version en développement actif** |
> | Stack | Python/FastAPI + HTML statique | Next.js 16 + MapLibre |
> | Code | brain `claude-brain` → `projects/open-radar-fr/` | repo **`Skycissou/osiris`** · branche **`master`** |
> | URL | `osiris.cissouhub.cloud` (+ `openradar.`) | `osiris-v4.cissouhub.cloud` |
> | Conteneur | `osiris-v3` | **`osiris-v4`** (compose autonome `docker-compose.v4.yml`) — Émancipation FAITE (13/07) ; ancien `osiris-v4-cockpit` stoppé |
> | Auth | login cookie V3 (comptes `.env`) | Better Auth + Postgres (brief 2026-07-12) |
> | Interdits | ❌ aucun nouveau dev ❌ jamais toucher sans GO Cissou | ❌ ne JAMAIS builder/servir depuis les dossiers ou statics V3 |
>
> **Règle de langage (tous agents)** : jamais « OSIRIS » tout court dans un handoff/une note → toujours « **V3 (prod)** » ou « **V4 (dev)** ». État courant → brain `notes/infra/deployments-registry.md`.

## 🗺️ Topologie — règle n°1
- `master` = V4 courante = LA référence (branche par défaut du repo). Le staging déploie CETTE branche.
- Branches `backup/*` = points de restauration — ne jamais supprimer.
- La branche `claude/v4-opus-switch-points-m91ofq` est OBSOLÈTE (fusionnée dans `master` le 2026-07-07 ; suppression prévue J+7). Ne plus bosser dessus.
- ⛔ La PROD V3 (`osiris.cissouhub.cloud`) ne dépend PAS de ce repo (source = clone du brain sur le VPS). On n'y touche jamais d'ici.

## 🚀 Déploiement V4 — HOST ÉMANCIPÉ (détail : DEPLOY.md) — compose autonome
> ⚠️ **La bascule Émancipation EST FAITE (13/07).** `osiris-v4.cissouhub.cloud` est servi ENTIÈREMENT par le conteneur **`osiris-v4`** (compose autonome `docker-compose.v4.yml`, label Traefik `Host(osiris-v4.cissouhub.cloud)` **priorité 200**). L'ancienne procédure « combiné-staging » (`osiris-v4-cockpit`) est **PÉRIMÉE** : Traefik ne route PLUS vers elle → la rebuilder ne change RIEN (leçon 13/07).

> ✅ **DETTE D1 réconciliée (16/07, Hermès)** : `docker-compose.v4.yml` référence `osiris-v4-ipallow@file` sur `master`. L'IP maison reste hors Git dans la configuration dynamique Traefik du VPS. Après deploy, une IP non autorisée doit obtenir `403` sur `/`; les routes ingest restent token-protected et doivent répondre `401` sans token. Détail : `DETTE.md`.

1. `[VPS]` `cd /docker/osiris-v4 && git fetch origin && git reset --hard origin/master && git log --oneline -1` ← sinon rebuild de VIEUX code
2. `[VPS]` `docker compose -f docker-compose.v4.yml build --no-cache` ← **`--build` seul NE force PAS le rebuild** (layers `CACHED` = vieux code)
3. `[VPS]` `docker compose -f docker-compose.v4.yml up -d --force-recreate` ← **« Started » ≠ « Recreated »** : sans `--force-recreate` le conteneur garde la vieille image
4. `[VPS]` vérif (attendre le boot) : `curl -s https://osiris-v4.cissouhub.cloud/cockpit/version` → doit renvoyer la version de `src/lib/version.ts` (⚠️ `Bad Gateway` = curl trop tôt après le start)

## ✅ Vérif post-déploiement — OBLIGATOIRE avant de dire « déployé »
- Le header sur `https://osiris-v4.cissouhub.cloud/cockpit` affiche la version de `src/lib/version.ts`.
- Monitoring : `https://osiris-v4.cissouhub.cloud/cockpit/live-feed/diag` (ok/échec par source amont).
- Pas vérifié = écrire « à vérifier », JAMAIS l'affirmer. « C'est fait » sans preuve = pas fait.

## 🧭 Hygiène session
- 1 tâche = 1 session. Ça boucle 2× sur la même erreur → STOP : écrire l'état dans un fichier, `/clear`, repartir.
- Fichier pointé non lu → le dire. Info incertaine → le dire. Jamais broder.
- État prod/staging : source canonique = brain `notes/infra/deployments-registry.md` (règle 21 du brain).

## 🧹 Dette technique — lire avant de coder

- **`DETTE.md`** (racine) = photo de la dette embarquée. Source de vérité = brain `board/osiris-dette-technique.md` + brief `notes/veille/2026-07-16-osiris-dette-fixes-brief.md` (Lots A→E). On coche dans le brain, on rafraîchit la photo ici au même commit.
- Ligne rouge **B5** : ne jamais rendre le host paramétrable sur les fetchers qui bypassent `safeFetch`.

## 🔢 Versioning
- Source unique : `src/lib/version.ts` (`OSIRIS_VERSION`). +1 palier à CHAQUE chantier livré (build vert + push). Détail : `VERSION.md`.
- L'accueil V3 (repo brain `projects/open-radar-fr`) tient le même numéro en lockstep manuel.
