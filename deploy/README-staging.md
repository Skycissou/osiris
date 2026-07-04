# 🧪 OSIRIS V4 — Déploiement STAGING (test avant prod)

> But : une **version à toi + tes 3 testeurs** sur `osiris-v4.cissouhub.cloud`, **isolée** de la V3 prod (`osiris.cissouhub.cloud`, jamais touchée).
> Deux conteneurs même domaine : `/` → front Next.js V4 · `/api/*` → FastAPI staging dédié.
> **Cette version teste le cockpit search-first** (barre de recherche → carte + résultats).

---

## 🗺️ Schéma

```
                osiris.cissouhub.cloud      → V3 PROD (osiris-v3)         [INTOUCHÉE]
   Traefik ─┤
                osiris-v4.cissouhub.cloud   → V4 TEST
                     ├─ /        → osiris-v4-front  (Next.js :3000)
                     └─ /api/*   → osiris-v4-api    (FastAPI :8000, strip /api)
                        cookie login (osiris_session) partagé same-domain ✅
                        volumes DÉDIÉS (osiris_v4_cache / osiris_v4_data)
```

---

## ✅ Pré-requis (à faire une fois)

1. **DNS** `[Hostinger]` : enregistrement **A** `osiris-v4` → `76.13.41.17`
2. **Firewall** `[VPS]` : 443 déjà ouvert (Traefik) → **rien à ajouter** (pas de nouveau port public)
3. **Chemin backend** : vérifier que `/docker/claude-brain/projects/open-radar-fr/backend` existe sur le VPS (sinon corriger `context:` dans `docker-compose.staging.yml`)

---

## 🔑 Comptes testeurs (login cookie)

Générer un hash par personne `[VPS, dans le backend]` :
```bash
cd /docker/claude-brain/projects/open-radar-fr/backend
python3 -m open_radar.auth hash 'MotDePasseToi'
python3 -m open_radar.auth hash 'MotDePasseTesteur1'
python3 -m open_radar.auth hash 'MotDePasseTesteur2'
python3 -m open_radar.auth hash 'MotDePasseTesteur3'
python3 -m open_radar.auth secret          # génère OSIRIS_SESSION_SECRET (stable)
```

---

## ⚙️ Fichier `.env` (à côté du compose, chmod 600, JAMAIS commité)

```env
# 4 comptes "user:hash" séparés par des virgules (hash générés ci-dessus)
OSIRIS_LOGIN_USERS=cissou:pbkdf2_sha256....,testeur1:pbkdf2_sha256....,testeur2:...,testeur3:...
# secret long et STABLE (rotation = déconnecte tout le monde)
OSIRIS_SESSION_SECRET=colle_ici_le_secret_genere
```

---

## 🚀 Déploiement `[VPS]`

```bash
# depuis le dossier deploy/ de la repo osiris clonée sur le VPS
docker compose -f docker-compose.staging.yml --env-file .env up -d --build
```

## 🔍 Vérification (règle 10 — preuve, pas de "c'est fait")

```bash
curl -sI https://osiris-v4.cissouhub.cloud/            # 200 ou 302→/login
curl -sI https://osiris-v4.cissouhub.cloud/api/version # 200 (backend joignable via /api)
docker logs osiris-v4-front --tail 20
docker logs osiris-v4-api   --tail 20
```
Puis dans le navigateur : login → une recherche (adresse réelle) → point sur la carte + panneau résultats.

---

## ⚠️ Points de vigilance

- **Cookie** : le front appelle `/api/login` → Traefik strippe `/api` → FastAPI pose `osiris_session` (path `/`, samesite lax, secure). Same-domain → le cookie repart sur les `/api/*` suivants. Si login KO : vérifier que `OSIRIS_COOKIE_SECURE=1` + HTTPS OK, et que le strip fonctionne (`/api/version` doit répondre).
- **Isolation V3** : volumes `osiris_v4_*` dédiés, conteneurs `osiris-v4-*` distincts. La V3 (`osiris-v3`, volumes `osiris_cache`/`osiris_data`) n'est pas touchée.
- **Données carte** : aujourd'hui seules les **adresses géocodées (BAN)** s'affichent en points (limite backend — entreprise/DVF/RNA pas encore géocodés). Les autres résultats sont dans le panneau.
- **MAJ du staging** : `git pull` (front + backend) puis re-`up -d --build`.
- **Bascule en prod plus tard** : quand validé, on réplique la logique dans le déploiement principal (ou on bascule le domaine) — étape séparée, sous GO.
