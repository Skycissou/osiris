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
> | Conteneur | `osiris-v3` | `osiris-v4-cockpit` → cible : app autonome (chantier Émancipation) |
> | Auth | login cookie V3 (comptes `.env`) | Better Auth + Postgres (brief 2026-07-12) |
> | Interdits | ❌ aucun nouveau dev ❌ jamais toucher sans GO Cissou | ❌ ne JAMAIS builder/servir depuis les dossiers ou statics V3 |
>
> **Règle de langage (tous agents)** : jamais « OSIRIS » tout court dans un handoff/une note → toujours « **V3 (prod)** » ou « **V4 (dev)** ». État courant → brain `notes/infra/deployments-registry.md`.

## 🗺️ Topologie — règle n°1
- `master` = V4 courante = LA référence (branche par défaut du repo). Le staging déploie CETTE branche.
- Branches `backup/*` = points de restauration — ne jamais supprimer.
- La branche `claude/v4-opus-switch-points-m91ofq` est OBSOLÈTE (fusionnée dans `master` le 2026-07-07 ; suppression prévue J+7). Ne plus bosser dessus.
- ⛔ La PROD V3 (`osiris.cissouhub.cloud`) ne dépend PAS de ce repo (source = clone du brain sur le VPS). On n'y touche jamais d'ici.

## 🚀 Déploiement staging (détail : DEPLOY.md) — 3 étapes DANS L'ORDRE
1. `[VPS]` `cd /docker/osiris-v4 && git fetch origin && git reset --hard origin/master`  ← OBLIGATOIRE sinon rebuild de VIEUX code (leçon 05/07)
2. `[VPS]` `cd /docker/osiris-v4/deploy && docker compose -f docker-compose.staging.yml down` (garde-fou anti-doublon, leçon 05/07 — ignorer si ce compose n'existe pas)
3. `[VPS]` `cd /docker/osiris-v3-staging/projects/open-radar-fr && docker compose -f docker-compose.staging-combined.yml build --no-cache osiris-v4-cockpit && docker compose -f docker-compose.staging-combined.yml up -d --no-deps osiris-v4-cockpit`

## ✅ Vérif post-déploiement — OBLIGATOIRE avant de dire « déployé »
- Le header sur `https://osiris-v4.cissouhub.cloud/cockpit` affiche la version de `src/lib/version.ts`.
- Monitoring : `https://osiris-v4.cissouhub.cloud/cockpit/live-feed/diag` (ok/échec par source amont).
- Pas vérifié = écrire « à vérifier », JAMAIS l'affirmer. « C'est fait » sans preuve = pas fait.

## 🧭 Hygiène session
- 1 tâche = 1 session. Ça boucle 2× sur la même erreur → STOP : écrire l'état dans un fichier, `/clear`, repartir.
- Fichier pointé non lu → le dire. Info incertaine → le dire. Jamais broder.
- État prod/staging : source canonique = brain `notes/infra/deployments-registry.md` (règle 21 du brain).

## 🔢 Versioning
- Source unique : `src/lib/version.ts` (`OSIRIS_VERSION`). +1 palier à CHAQUE chantier livré (build vert + push). Détail : `VERSION.md`.
- L'accueil V3 (repo brain `projects/open-radar-fr`) tient le même numéro en lockstep manuel.
