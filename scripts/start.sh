#!/usr/bin/env bash
# scripts/start.sh
# ─────────────────────────────────────────────────────────────────────────────
# One-command launcher for the DFS cluster.
# Works in two modes:
#   1. Full Docker mode   → docker-compose up (all 6 services)
#   2. Go-only mode       → runs coordinator + 4 simulated nodes locally
# ─────────────────────────────────────────────────────────────────────────────

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   DFS — Distributed File Storage         ║${NC}"
echo -e "${BLUE}║   Reed-Solomon Erasure Coding Cluster     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Check which mode to use ──────────────────────────────────────────────────
HAS_DOCKER=false
HAS_GO=false

if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  HAS_DOCKER=true
fi

if command -v go &>/dev/null; then
  HAS_GO=true
fi

# ── MODE 1: Full Docker (preferred) ─────────────────────────────────────────
if $HAS_DOCKER; then
  ok "Docker detected — launching full cluster"
  info "Starting: 4 C++ storage nodes + Go coordinator + nginx frontend"
  echo ""
  cd "$ROOT"
  docker-compose up --build
  exit 0
fi

# ── MODE 2: Go-only (coordinator + mock nodes) ───────────────────────────────
if $HAS_GO; then
  warn "Docker not running — starting Go coordinator only"
  warn "Storage nodes will be simulated (no real C++ nodes)"
  echo ""

  cd "$ROOT/coordinator"

  # Download deps if needed
  if [ ! -f go.sum ] || ! go mod verify &>/dev/null 2>&1; then
    info "Downloading Go dependencies..."
    go mod tidy
  fi

  ok "Starting coordinator on :8080"
  info "Open the dashboard: file://${ROOT}/frontend/index.html"
  info "Or serve frontend: python3 -m http.server 3000 --directory ${ROOT}/frontend"
  echo ""
  echo "  Dashboard → http://localhost:3000  (if python server running)"
  echo "  API       → http://localhost:8080/api/health"
  echo ""
  echo "Press Ctrl+C to stop."
  echo ""

  go run . \
    NODE_0_ADDR=localhost:50051 \
    NODE_1_ADDR=localhost:50052 \
    NODE_2_ADDR=localhost:50053 \
    NODE_3_ADDR=localhost:50054
  exit 0
fi

# ── Neither available ─────────────────────────────────────────────────────────
echo ""
echo "Neither Docker nor Go is installed."
echo ""
echo "Install options:"
echo "  brew install --cask docker   # Full cluster (recommended)"
echo "  brew install go              # Coordinator only"
echo ""
echo "Or open the dashboard directly — it runs in Demo Mode in your browser:"
echo "  open ${ROOT}/frontend/index.html"
echo ""
exit 1
