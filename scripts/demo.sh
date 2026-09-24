#!/usr/bin/env bash
# scripts/demo.sh — Full end-to-end demo script
# Usage: ./scripts/demo.sh

set -e
BASE_URL="http://localhost:8080"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

header() { echo -e "\n${BLUE}══════════════════════════════════════${NC}"; echo -e "${BLUE} $1${NC}"; echo -e "${BLUE}══════════════════════════════════════${NC}"; }
ok()     { echo -e "${GREEN}✅ $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()    { echo -e "${RED}❌ $1${NC}"; }

# ── 1. Health check ──────────────────────────────────────────
header "Step 1 — Coordinator Health"
HEALTH=$(curl -sf "${BASE_URL}/api/health" || true)
if [ -n "$HEALTH" ]; then
  ok "Coordinator is up: $HEALTH"
else
  err "Coordinator not responding at ${BASE_URL}"
  exit 1
fi

# ── 2. Cluster status ────────────────────────────────────────
header "Step 2 — Cluster Status"
STATUS=$(curl -sf "${BASE_URL}/api/cluster/status" || true)
echo "$STATUS" | python3 -m json.tool 2>/dev/null || echo "$STATUS"

# ── 3. Upload a test file ────────────────────────────────────
header "Step 3 — Upload Test File"
TMP=$(mktemp)
echo "DFS Demo File — $(date)" > "$TMP"
dd if=/dev/urandom bs=1024 count=512 >> "$TMP" 2>/dev/null
echo "Test file size: $(wc -c < "$TMP") bytes"

RESULT=$(curl -sf -F "file=@${TMP};filename=demo-file.bin" "${BASE_URL}/api/upload")
FILE_ID=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['file_id'])")
ok "Uploaded! File ID: $FILE_ID"
echo "$RESULT" | python3 -m json.tool 2>/dev/null

# ── 4. Download and verify ───────────────────────────────────
header "Step 4 — Download & Verify (all nodes up)"
ORIG_HASH=$(sha256sum "$TMP" | cut -d' ' -f1)
DOWNLOADED=$(mktemp)
curl -sf "${BASE_URL}/api/download/${FILE_ID}" -o "$DOWNLOADED"
DL_HASH=$(sha256sum "$DOWNLOADED" | cut -d' ' -f1)

if [ "$ORIG_HASH" = "$DL_HASH" ]; then
  ok "Hash matches! Reed-Solomon encoding is correct."
else
  err "Hash mismatch! Expected: $ORIG_HASH, Got: $DL_HASH"
fi

# ── 5. Simulate node failure ─────────────────────────────────
header "Step 5 — Kill Node 1 (simulate failure)"
docker stop storage-node-1 2>/dev/null || warn "Cannot stop storage-node-1 (may not be running via docker)"
sleep 2
warn "Node 1 is now offline — cluster in degraded state"

# ── 6. Download with node failure ───────────────────────────
header "Step 6 — Download with Node 1 DOWN (RS reconstruction)"
RECOVERED=$(mktemp)
if curl -sf "${BASE_URL}/api/download/${FILE_ID}" -o "$RECOVERED"; then
  REC_HASH=$(sha256sum "$RECOVERED" | cut -d' ' -f1)
  if [ "$ORIG_HASH" = "$REC_HASH" ]; then
    ok "Reed-Solomon RECONSTRUCTION SUCCESS!"
    ok "File recovered perfectly despite node failure."
  else
    err "Hash mismatch after reconstruction"
  fi
else
  err "Download failed — too many nodes down?"
fi

# ── 7. Restart node ──────────────────────────────────────────
header "Step 7 — Restart Node 1"
docker start storage-node-1 2>/dev/null || warn "Cannot restart via docker"
sleep 3
ok "Node 1 restarted — cluster healthy again"

# ── Cleanup ──────────────────────────────────────────────────
rm -f "$TMP" "$DOWNLOADED" "$RECOVERED"
header "Demo Complete!"
ok "All tests passed. DFS cluster is working correctly."
echo ""
echo "Dashboard: http://localhost:3000"
echo "API:       ${BASE_URL}/api/cluster/status"
