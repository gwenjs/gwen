#!/bin/bash
# check-wasm-sizes.sh — Validate gzipped WASM sizes (RFC-V2-006)

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Targets in KB
TARGET_LIGHT=55
TARGET_PHYSICS2D=220

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WASM_BASE="$PROJECT_ROOT/packages/core/wasm"

log_info() { echo -e "${BLUE}ℹ${NC} $*"; }
log_success() { echo -e "${GREEN}✓${NC} $*"; }
log_error() { echo -e "${RED}✗${NC} $*"; }

check_size() {
  local variant="$1"
  local target="$2"
  local wasm_file="$WASM_BASE/$variant/gwen_core_bg.wasm"

  if [ ! -f "$wasm_file" ]; then
    log_error "File not found: $wasm_file"
    return 1
  fi

  local raw_size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file")
  local gz_size=$(gzip -c "$wasm_file" | wc -c)
  local gz_kb=$(echo "scale=2; $gz_size / 1024" | bc)
  
  local status_color="${GREEN}"
  local status_icon="✓"
  
  if (( $(echo "$gz_kb > $target" | bc -l) )); then
    status_color="${RED}"
    status_icon="✗"
    FAILED=1
  fi

  echo -e "${status_color}${status_icon}${NC} ${variant}: ${gz_kb}KB (target: ${target}KB, raw: $((raw_size / 1024))KB)"
}

main() {
  log_info "📊 Checking gzipped WASM sizes..."
  echo ""
  
  FAILED=0
  
  check_size "light" "$TARGET_LIGHT"
  check_size "physics2d" "$TARGET_PHYSICS2D"
  # Physics3D doesn't have a strict target in RFC but we'll monitor it
  check_size "physics3d" 1000 
  
  echo ""
  if [ $FAILED -eq 0 ]; then
    log_success "All WASM sizes within targets!"
    exit 0
  else
    log_error "Some WASM sizes exceeded targets!"
    exit 1
  fi
}

main "$@"
