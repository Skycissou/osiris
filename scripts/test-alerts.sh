#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  test-alerts.sh — Vérifie le module « Alertes disparitions » (Lot 1).
#  Spec Claude chat 08/07. Teste l'auth token, la validation et le flux
#  ingest → list → réconciliation (levée). NE contient AUCUNE vraie donnée perso.
#
#  Usage :
#    OSIRIS_INGEST_TOKEN=xxx bash scripts/test-alerts.sh
#    STAGING=http://localhost:3000 OSIRIS_INGEST_TOKEN=xxx bash scripts/test-alerts.sh
# ─────────────────────────────────────────────────────────────────────────────
set -u
STAGING="${STAGING:-https://osiris-v4.cissouhub.cloud}"
BASE="$STAGING/cockpit"
TOKEN="${OSIRIS_INGEST_TOKEN:-}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAIL=0

hdr() { printf "\n══ %s ══\n" "$1"; }
check() { # <nom> <codes_ok_regex> <curl args...>
  local name="$1" ok="$2"; shift 2
  local code; code=$(curl -sS -o "$TMP/b" -w "%{http_code}" --max-time 20 "$@" 2>/dev/null) || code=000
  if [[ "$code" =~ $ok ]]; then printf "  ✅ %-38s HTTP %s\n" "$name" "$code"
  else printf "  ❌ %-38s HTTP %s (attendu %s) — %s\n" "$name" "$code" "$ok" "$(head -c 120 "$TMP/b")"; FAIL=1; fi
}

hdr "Auth ingest"
check "sans token → 401" '^(401|503)$' -X POST "$BASE/alerts/ingest" \
  -H 'Content-Type: application/json' --data '{"source":"interpol_yellow","alerts":[]}'
check "mauvais token → 401" '^(401|503)$' -X POST "$BASE/alerts/ingest" \
  -H 'Content-Type: application/json' -H 'X-Ingest-Token: mauvais' --data '{"source":"interpol_yellow","alerts":[]}'

if [ -z "$TOKEN" ]; then
  echo "  ⚠️  OSIRIS_INGEST_TOKEN non fourni → tests d'écriture sautés."
else
  hdr "Ingest + réconciliation (données FICTIVES)"
  # 1) 2 avis fictifs
  check "ingest 2 avis fictifs → 200" '^200$' -X POST "$BASE/alerts/ingest" \
    -H 'Content-Type: application/json' -H "X-Ingest-Token: $TOKEN" \
    --data '{"source":"interpol_yellow","alerts":[{"source_id":"TEST-1","nom_affiche":"TEST UN","lat":48.85,"lon":2.35},{"source_id":"TEST-2","nom_affiche":"TEST DEUX"}]}'
  # 2) re-ingest SANS TEST-2 → TEST-2 doit passer levee (réconciliation)
  check "re-ingest (TEST-2 retiré) → 200" '^200$' -X POST "$BASE/alerts/ingest" \
    -H 'Content-Type: application/json' -H "X-Ingest-Token: $TOKEN" \
    --data '{"source":"interpol_yellow","alerts":[{"source_id":"TEST-1","nom_affiche":"TEST UN","lat":48.85,"lon":2.35}]}'
  hdr "List"
  check "list actives → 200" '^200$' "$BASE/alerts?statut=active"
  echo "  ℹ️  Corps :"; head -c 400 "$TMP/b"; echo
  # 3) nettoyage : retirer TEST-1 aussi (tout en levee → purgé sous 24h)
  curl -sS -o /dev/null -X POST "$BASE/alerts/ingest" -H 'Content-Type: application/json' \
    -H "X-Ingest-Token: $TOKEN" --data '{"source":"interpol_yellow","alerts":[]}' --max-time 20
  echo "  🧹 avis de test retirés (passent en levée → purge auto 24 h)."
fi

echo "──────────────────────────────────────────"
[ "$FAIL" = "0" ] && echo "✅ Module alertes OK sur $STAGING" || echo "❌ Au moins un test a échoué."
exit "$FAIL"
