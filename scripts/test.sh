#!/usr/bin/env bash
# scripts/test.sh — Quick API smoke tests
# Usage: ./scripts/test.sh [base_url]

set -e
BASE=${1:-"http://localhost:8080"}
PASS=0; FAIL=0

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

pass() { echo -e "${GREEN}  PASS${NC} $1"; ((++PASS)); }
fail() { echo -e "${RED}  FAIL${NC} $1"; ((++FAIL)); }

echo -e "\n${BLUE}DFS Quick Test Suite${NC}"
echo -e "${BLUE}Target: ${BASE}${NC}\n"

# Health
RESP=$(curl -sf "${BASE}/api/health" || echo "")
if echo "$RESP" | grep -q '"status":"ok"'; then
  pass "GET /api/health"
else
  fail "GET /api/health — response: $RESP"
fi

# Cluster status
RESP=$(curl -sf "${BASE}/api/cluster/status" || echo "")
if echo "$RESP" | grep -q '"total_nodes":4'; then
  pass "GET /api/cluster/status — 4 nodes"
else
  fail "GET /api/cluster/status — response: $RESP"
fi

# Upload
TMP=$(mktemp)
echo "Hello, DFS! Test data $(date +%s)" > "$TMP"
RESP=$(curl -sf -F "file=@${TMP};filename=test.txt" "${BASE}/api/upload" || echo "")
if echo "$RESP" | grep -q '"success":true'; then
  FILE_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['file_id'])" 2>/dev/null || echo "")
  pass "POST /api/upload — ID: ${FILE_ID:0:8}…"
else
  fail "POST /api/upload — response: $RESP"
  FILE_ID=""
fi

# File list
RESP=$(curl -sf "${BASE}/api/files" || echo "")
if echo "$RESP" | grep -q '"files"'; then
  pass "GET /api/files"
else
  fail "GET /api/files — response: $RESP"
fi

# Download (only if upload succeeded)
if [ -n "$FILE_ID" ]; then
  DOWNLOADED=$(mktemp)
  HTTP_CODE=$(curl -sf -o "$DOWNLOADED" -w "%{http_code}" "${BASE}/api/download/${FILE_ID}" || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    ORIG=$(cat "$TMP")
    RECV=$(cat "$DOWNLOADED")
    if [ "$ORIG" = "$RECV" ]; then
      pass "GET /api/download — content matches"
    else
      fail "GET /api/download — content mismatch"
    fi
  else
    fail "GET /api/download — HTTP $HTTP_CODE"
  fi
  rm -f "$DOWNLOADED"
fi

rm -f "$TMP"

echo ""
echo -e "Results: ${GREEN}${PASS} passed${NC} / ${RED}${FAIL} failed${NC}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
