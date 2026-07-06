#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
#  OSIRIS — Hook SessionStart (Claude Code sur le web)
#  Installe les dépendances npm pour que build / lint / typecheck marchent
#  dès le début d'une session web. Idempotent, non-interactif.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Ne tourne QUE dans l'environnement distant (Claude Code web) — en local on ne
# veut pas déclencher un install à chaque ouverture.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# npm install (pas `ci`) : profite du cache du conteneur après le hook, et reste
# tolérant si node_modules existe déjà.
npm install --no-audit --no-fund
