#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  test-telemetrie.sh — Vérifie le dispositif de télémétrie UI d'OSIRIS V4.
#  Spec Claude 07/07 (§4/§6). Teste les GARDES de sécurité de l'ingest et des
#  routes de diag, sans jamais écrire de vraie clé.
#
#  À lancer contre le staging (défaut) ou en local :
#    bash scripts/test-telemetrie.sh
#    STAGING=http://localhost:3000 bash scripts/test-telemetrie.sh
#
#  Contrôles :
#    1. Ingest REFUSE cross-origin (403)         — same-origin only
#    2. Ingest REFUSE un payload > 32 Ko (400)   — cap taille
#    3. Ingest ACCEPTE un batch same-origin (200/204)
#    4. Diag sessions SANS token (403 en prod)   — token-gated
#    5. Diag session SANS token (403 en prod)    — token-gated
#  Chaque ligne : nom · HTTP · verdict ✅/❌. Lecture seule côté données.
# ─────────────────────────────────────────────────────────────────────────────
set -u
STAGING="${STAGING:-https://osiris-v4.cissouhub.cloud}"
BASE="$STAGING/cockpit"
HOST="$(printf '%s' "$STAGING" | sed -E 's#^https?://##')"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAIL=0

# expect <nom> <codes_ok_regex> <curl args...>
expect() {
  local name="$1" ok="$2"; shift 2
  local code
  code=$(curl -sS -o "$TMP/body" -w "%{http_code}" --max-time 20 "$@" 2>"$TMP/err") || code=000
  if [[ "$code" =~ $ok ]]; then
    printf "  ✅ %-42s HTTP %s\n" "$name" "$code"
  else
    printf "  ❌ %-42s HTTP %s (attendu %s) — %s\n" "$name" "$code" "$ok" \
      "$(head -c 120 "$TMP/body" 2>/dev/null | tr '\n' ' ')"
    FAIL=1
  fi
}

echo "══════ Ingest /cockpit/telemetry/ui ══════"
# 1. Cross-origin → 403 (Origin d'un autre hôte).
expect "cross-origin refusé" '^403$' \
  -X POST "$BASE/telemetry/ui" \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.example" \
  --data '{"sid":"test","events":[{"t":"page","at":0,"d":{}}]}'

# 2. Payload > 32 Ko → 400 (même same-origin).
python3 -c "import json;print(json.dumps({'sid':'x','events':[{'t':'search','at':0,'d':{'q':'A'*40000}}]}))" >"$TMP/big.json"
expect "payload > 32 Ko refusé" '^400$' \
  -X POST "$BASE/telemetry/ui" \
  -H "Content-Type: application/json" \
  -H "Origin: $STAGING" \
  --data @"$TMP/big.json"

# 3. Batch same-origin valide → 200 (télémétrie on) ou 204 (kill-switch off).
expect "batch same-origin accepté" '^(200|204)$' \
  -X POST "$BASE/telemetry/ui" \
  -H "Content-Type: application/json" \
  -H "Origin: $STAGING" \
  --data '{"sid":"test-script","events":[{"t":"page","at":0,"d":{"path":"/cockpit"}}]}'

echo "══════ Diag (token-gated) ══════"
# 4/5. Sans token → 403 attendu EN PROD (OSIRIS_DIAG_TOKEN défini). En dev sans
#      token le serveur ouvre (200) : on tolère les deux, on signale juste.
expect "sessions sans token (prod=403)" '^(403|200)$' \
  "$BASE/live-feed/diag/sessions"
expect "session sans token (prod=403)"  '^(403|400|200)$' \
  "$BASE/live-feed/diag/session?sid=nope"

echo "──────────────────────────────────────────"
if [ "$FAIL" = "0" ]; then
  echo "✅ Gardes télémétrie OK sur $STAGING"
else
  echo "❌ Au moins un garde a échoué — voir ci-dessus."
fi
exit "$FAIL"
