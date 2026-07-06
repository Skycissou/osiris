#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────
#  OSIRIS — Hook PreToolUse : protège les fichiers .env (secrets).
#  Bloque toute édition/écriture d'un .env* SAUF .env.example (template public).
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

input=$(cat)
file=$(printf '%s' "$input" | python3 -c "import sys,json; d=json.load(sys.stdin); print((d.get('tool_input') or {}).get('file_path',''))" 2>/dev/null || echo "")
base=$(basename "$file" 2>/dev/null || echo "")

# .env.example = doc sans secret → autorisé. Tout autre .env* → bloqué.
if [[ "$base" == ".env" || "$base" == .env.* ]] && [[ "$base" != ".env.example" ]]; then
  echo "🚫 Édition de '$base' bloquée : fichier de secrets. Documente plutôt dans .env.example." >&2
  exit 2
fi
exit 0
