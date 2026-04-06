#!/bin/bash
# build-wasm.sh — Build multi-variant WASM artifacts (RFC-V2-006)
#
# This script:
# 1. Builds gwen-core with different Cargo features (light, physics2d, physics3d)
# 2. Places each variant in its own subdirectory in @gwenjs/core/wasm/
# 3. Optimizes the output with wasm-opt if available
# 4. Cleans up unnecessary wasm-pack artifacts

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="$PROJECT_ROOT/crates/gwen-core"
ENGINE_CORE_WASM="$PROJECT_ROOT/packages/core/wasm"

# Functions
log_info() {
  echo -e "${BLUE}ℹ${NC} $*"
}

log_success() {
  echo -e "${GREEN}✓${NC} $*"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $*"
}

log_error() {
  echo -e "${RED}✗${NC} $*"
}

# Check prerequisites
check_prerequisites() {
  if ! command -v wasm-pack &> /dev/null; then
    log_error "wasm-pack is not installed. Install with: cargo install wasm-pack"
    exit 1
  fi

  if ! command -v wasm-opt &> /dev/null; then
    log_warn "wasm-opt not found. Skipping additional post-build optimization."
  else
    log_success "wasm-opt found for post-processing."
  fi
}

# Build a specific variant
build_variant() {
  local variant="$1"
  local features="$2"
  local out_dir="$ENGINE_CORE_WASM/$variant"

  log_info "Building variant: $variant (features: ${features:-none})"

  # Ensure out_dir is clean
  rm -rf "$out_dir"
  mkdir -p "$out_dir"

  # Build with wasm-pack
  local feature_args=""
  if [ -n "$features" ]; then
    feature_args="-- --features $features"
  else
    feature_args="-- --no-default-features"
  fi

  wasm-pack build "$CRATE_DIR" \
    --target web \
    --release \
    --out-dir "$out_dir" \
    --out-name gwen_core \
    $feature_args

  # Cleanup wasm-pack noise
  rm -f "$out_dir/.gitignore" "$out_dir/package.json" "$out_dir/README.md"

  # Post-process with wasm-opt if available
  if command -v wasm-opt &> /dev/null; then
    local wasm_file="$out_dir/gwen_core_bg.wasm"
    log_info "  Running wasm-opt -Oz on $variant..."
    wasm-opt -Oz "$wasm_file" -o "$wasm_file.opt"
    mv "$wasm_file.opt" "$wasm_file"
  fi

  log_success "Built $variant variant"
  ls -lh "$out_dir" | awk '{print "    - " $9 " (" $5 ")"}'
}

# Main
main() {
  log_info "🚀 Starting Multi-Variant WASM Build Pipeline (RFC-V2-006)"
  echo ""

  check_prerequisites
  echo ""

  # 1. Build light variant (no physics, no pathfinding)
  build_variant "light" ""
  echo ""

  # 2. Build physics2d variant
  build_variant "physics2d" "physics2d"
  echo ""

  # 3. Build physics3d variant
  build_variant "physics3d" "physics3d"
  echo ""

  # Build Node.js target for Vite plugin build-tools
  log_info "Building gwen-core build-tools (Node.js target)..."
  wasm-pack build "$CRATE_DIR" \
    --target nodejs \
    --release \
    --out-dir "$PROJECT_ROOT/packages/physics3d/build-tools" \
    -- --features "build-tools" --no-default-features 2>&1

  # Clean up wasm-pack Node.js artifacts we don't need
  rm -f "$PROJECT_ROOT/packages/physics3d/build-tools/.gitignore"
  log_info "Build-tools WASM built successfully"
  echo ""

  # 4. Build gwen-physics3d-fracture (standalone Voronoi fracture module)
  build_fracture() {
    local out_dir="$PROJECT_ROOT/packages/physics3d-fracture/wasm"
    local crate_dir="$PROJECT_ROOT/crates/gwen-physics3d-fracture"

    log_info "Building fracture variant (gwen-physics3d-fracture)"

    rm -rf "$out_dir"
    mkdir -p "$out_dir"

    wasm-pack build "$crate_dir" \
      --target web \
      --release \
      --out-dir "$out_dir" \
      --out-name gwen_physics3d_fracture

    rm -f "$out_dir/.gitignore" "$out_dir/package.json" "$out_dir/README.md"

    if command -v wasm-opt &> /dev/null; then
      local wasm_file="$out_dir/gwen_physics3d_fracture_bg.wasm"
      log_info "  Running wasm-opt -Oz on fracture..."
      wasm-opt -Oz "$wasm_file" -o "$wasm_file.opt"
      mv "$wasm_file.opt" "$wasm_file"
    fi

    log_success "Built fracture variant"
    ls -lh "$out_dir" | awk '{print "    - " $9 " (" $5 ")"}'
  }
  build_fracture
  echo ""

  log_success "🎉 All WASM variants built successfully!"
}

main "$@"
