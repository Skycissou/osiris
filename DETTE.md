# 🧹 DETTE.md — dette technique OSIRIS V4

> ⚠️ **SOURCE DE VÉRITÉ = le brain** `Skycissou/claude-brain` :
> · cases à cocher → `board/osiris-dette-technique.md`
> · brief exécutable (Lots A→E, critères ✅) → `notes/veille/2026-07-16-osiris-dette-fixes-brief.md`
> Ce fichier = **photo embarquée dans le repo** pour qu'aucune session (Claude Code, Hermès, humain) ne démarre sans voir la dette. On coche dans le brain ; on rafraîchit la photo ici quand un lot est livré (même commit).
>
> Créé 2026-07-16 (Claude chat, GO Cissou) — audit dette sur `5b49c4f` (V4.102) + revue code/sécu V4.115 (`53df908`, validée Cissou, 0 🔴).

## 🔴 D1 — BLOCKER À CHECKER AVANT TOUT DEPLOY

- L'**allowlist IP Traefik** (commit local VPS `34535ec`, filtre d'Hermès) n'a **JAMAIS été poussée sur master** → le `git reset --hard origin/master` de la procédure de deploy **l'efface** → V4 redevient **PUBLIC** (auth encore en bypass `AUTH_ENFORCE`).
- Règle tant que le brain (STATE.md) n'indique pas « **D1 réconcilié sur master** » :
  1. **ZÉRO deploy** dans les sessions de dette/features.
  2. Si un deploy est inévitable (GO Cissou) → **stash/pull/pop du compose** pour préserver le filtre (procédure utilisée pour V4.109).
- Réconciliation = **Hermès** (relais envoyé le 16/07 : reporter le diff sur master, SANS l'IP en clair).

## 📋 Les lots (exécution : Claude Code local / Hermès)

| Lot | Contenu | Effort | Statut |
|---|---|---|---|
| A | B4 logs debug CCTV · B3 URL photo absolue · B6 header frontline | ~20 min | ☐ |
| E | Retours revue V4.115 : E1 collision picker · E2 DRY opacité · E3 recolor no-op | ~15 min | ☐ |
| B | B2 photos sondées · B1 re-géocodage ville (LE morceau) | ~1 h | ☐ |
| C | D4 purge fork amont (`intel/`, `nginx/`, compose racine) — **checkpoint GO Cissou avant `git rm`** | ~20 min | ☐ |
| D | D3 CI GitHub Actions (build + tsc + lint) | ~15 min | ☐ |

## 🐞 Détail des points

| # | Grav. | Fichier | Résumé |
|---|---|---|---|
| B1 | 🟠 | `src/lib/arpd/sync.ts` | Re-géocodage ville jamais fait : avis figés au centroïde département (cap 150 atteint au 1er sync + condition `lat !== undefined`). Stocker `geoPrecision`, re-tenter au sync. Géocodeur = IGN Géoplateforme UNIQUEMENT (BAN décommissionnée 04/2026) |
| B2 | 🟡 | `src/lib/arpd/sync.ts` | Avis sans photo détail re-fetché à CHAQUE sync → marquer « sondé », budget 80/run préservé |
| B3 | 🟡 | `src/lib/arpd/parser.ts` | `ARPD_BASE + imgM[1]` casse si l'URL du listing devient absolue → garder tel quel si `http…` |
| B4 | 🟡 | `src/app/cockpit/live-feed/sensitive/route.ts` | 2 `console.error('[CCTV windy] …')` TEMPORAIRES à retirer |
| B5 | 🔵 | même fichier | **Dette sécu ASSUMÉE** : `fetchOverpass`/`fetchCctvWindy` bypassent `safeFetch` (dns.lookup KO sur VPS). Hôtes constants → OK. **Sentinelle only, pas de fix** — voir Lignes rouges |
| B6 | 🔵 | même fichier | `fetchFrontline` lit l'env en direct → accepter `x-osiris-key-frontline` comme les autres couches |
| E1 | 🟠 | `src/components/OsirisMap.tsx` | Collision outil mesure × picker départements : mesure armée + grille Caméras → le même clic fait l'action mesure ET `onDeptPick`. Fix : `if (drawModeRef.current !== 'off') return;` en tête du handler `dept-picker-fill` |
| E2 | 🟢 | `src/components/OsirisMap.tsx` | Constantes d'opacité `0.08/0.13` du fond en double (création calque `draw-fill` + toggle) → const partagée. ⚠️ garder un `case` PLAT (jamais d'interpolation-zoom imbriquée — leçon MapLibre 16/07, 3 récidives) |
| E3 | 🟢 | `src/components/OsirisMap.tsx` | Recolor no-op (objet déjà à la couleur courante) re-rend toutes les étiquettes → garde `f.color !== drawColorRef.current` |
| D2 | 🟠 | `tests/` (absent) | Zéro test rejouable commité (runners « sandbox » only, `tests/golden/` 404). ⏸️ attend « **GO GDS** » explicite de Cissou |
| D3 | 🟠 | `.github/workflows/` (absent) | Pas de CI → Lot D. Si scope `workflow` manquant sur les creds → déléguer le fichier à Hermès (`gh`) |
| D4 | 🟠 | `intel/` · `nginx/` · `docker-compose.yml` · `DOCKER.md` | Résidus du fork amont : `docker compose up` sans `-f` boote la stack FORK (ports hors Traefik) + `intel/node_modules` commité gonfle le build → purge (Lot C, GO avant `git rm`) |

## 🚫 Lignes rouges permanentes (toute session dans ce repo)

- **B5** : ne JAMAIS rendre le host paramétrable sur les fetchers qui bypassent `safeFetch` (SSRF). Vraie correction = réparer `dns.lookup` côté VPS (chantier Hermès).
- Nouvelle dépendance = **GO Cissou obligatoire** (`docs/stack/used/osiris.md` du brain à jour dans le même cycle).
- Ne pas toucher auth / `proxy.ts` / Traefik / `docker-compose.v4.yml` hors session dédiée (D1 = Hermès · D5 = brief auth).
- Routes `/cockpit/*` = prod ARPD → comportement à ne pas casser.
- Zéro source CCTV privée / Shodan (ligne rouge OSINT actée).

## 🟡 Plus tard (sessions dédiées)

- **D5** — Auth réelle : Better Auth + Postgres (`osiris-pg` prêt en commentaire dans le compose) — brief brain `notes/veille/2026-07-12-auth-osiris-v4.md`.
- **D6** — Découper les god-components (`page.tsx` ~64 Ko, `OsirisMap.tsx` ~86 Ko) — **APRÈS** le golden dataset (jamais de refonte UI sans tests).

---
*Photo du 2026-07-16. Prochain rafraîchissement : à la livraison d'un lot (cocher le brain + MAJ ce fichier dans le même commit).*
