#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  test-couches.sh — Vérifie TOUTES les couches SANS CLÉ d'OSIRIS V4.
#  Demande Cissou 07/07 : « il faut tester toutes ces couches-là ».
#
#  À lancer SUR LE VPS (ou n'importe quelle machine avec accès internet) :
#    bash scripts/test-couches.sh
#
#  2 passes :
#    1. AMONT   — la source publique répond-elle ? (adsb.lol, USGS, celestrak…)
#    2. STAGING — TON serveur les sert-il ? (osiris-v4.cissouhub.cloud/cockpit/…)
#  Chaque ligne : nom · HTTP · nb d'éléments · verdict ✅/❌.
#  Aucune clé requise, aucune écriture : lecture seule.
# ─────────────────────────────────────────────────────────────────────────────
set -u
STAGING="${STAGING:-https://osiris-v4.cissouhub.cloud}"
UA="OSIRIS-test-couches (defensif ARPD; contact: cyril.detout@gmail.com)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
FAIL=0

# check <nom> <compteur_python> <url> [args curl...]
#   compteur_python : expression python lisant le corps depuis sys.stdin → nombre
check() {
  local name="$1" counter="$2" url="$3"; shift 3
  local body="$TMP/body" code
  code=$(curl -sS -o "$body" -w "%{http_code}" --max-time 25 -H "User-Agent: $UA" "$@" "$url" 2>"$TMP/err") || code=000
  local n="-"
  if [ "$code" = "200" ] && [ -n "$counter" ]; then
    n=$(python3 -c "import sys,json;$counter" <"$body" 2>/dev/null || echo "?")
  fi
  if [ "$code" = "200" ] && [ "$n" != "0" ] && [ "$n" != "?" ]; then
    printf "  ✅ %-30s HTTP %s · %s élément(s)\n" "$name" "$code" "$n"
  else
    printf "  ❌ %-30s HTTP %s · %s — %s\n" "$name" "$code" "$n" "$(cat "$TMP/err" "$body" 2>/dev/null | head -c 120 | tr '\n' ' ')"
    FAIL=1
  fi
}

echo "══════ 1/2 SOURCES AMONT (les fournisseurs publics) ══════"
check "Avions (adsb.lol)"        'd=json.load(sys.stdin);print(len(d.get("ac") or []))' \
  "https://api.adsb.lol/v2/point/48.85/2.35/250"
check "Séismes (USGS)"           'd=json.load(sys.stdin);print(len(d.get("features") or []))' \
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"
check "Satellites (celestrak)"   'print(1 if "1 " in sys.stdin.read() else 0)' \
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle"
check "Géopolitique (GDELT geo)" 'd=json.load(sys.stdin);print(len(d.get("features") or []))' \
  "https://api.gdeltproject.org/api/v2/geo/geo?query=protest&format=GeoJSON&timespan=24h"
check "Cyber C2 (abuse.ch)"      'd=json.load(sys.stdin);print(len(d) if isinstance(d,list) else 0)' \
  "https://feodotracker.abuse.ch/downloads/ipblocklist.json"
check "News (GDELT doc)"         'd=json.load(sys.stdin);print(len(d.get("articles") or []))' \
  "https://api.gdeltproject.org/api/v2/doc/doc?query=france&mode=artlist&format=json&maxrecords=5"
check "Bases mil. (Overpass)"    'd=json.load(sys.stdin);print(len(d.get("elements") or []))' \
  "https://overpass-api.de/api/interpreter" --data "data=[out:json][timeout:20];node[military](43,1,44,2);out 5;"

echo
echo "══════ 2/2 STAGING ($STAGING) — ce que TON serveur sert ══════"
check "fast: avions (bbox Paris)" 'd=json.load(sys.stdin);print(len(d.get("aircraft") or []))' \
  "$STAGING/cockpit/live-feed/fast?bbox=1.5,47.9,3.2,49.7"
check "fast: avions (bbox USA)"   'd=json.load(sys.stdin);print(len(d.get("aircraft") or []))' \
  "$STAGING/cockpit/live-feed/fast?bbox=-75,39,-72,41.5"
check "slow: séismes+geo+cyber"   'd=json.load(sys.stdin);print(sum(len(d.get(k) or []) for k in ("earthquakes","gdelt","cyber","satellites")))' \
  "$STAGING/cockpit/live-feed/slow"
check "news (fil GDELT)"          'd=json.load(sys.stdin);print(len(d.get("articles") or []))' \
  "$STAGING/cockpit/news?q=cyber&lang=fr"

echo
if [ "$FAIL" = "0" ]; then
  echo "🟢 TOUT EST VERT — toutes les couches sans clé répondent."
else
  echo "🔴 AU MOINS UN TEST ÉCHOUE — colle cette sortie complète à Claude pour diagnostic."
fi
