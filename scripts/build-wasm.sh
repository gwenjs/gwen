#!/bin/bash
# build-wasm.sh — Build multi-variant WASM artifacts (RFC-V2-006)
#
# Builds the browser variants, the Node build-tools binary, the BVH worker,
# and the fracture module. Every browser binary is optimised with the wasm-opt
# version pinned in wasm-size.json.
# GWEN_SKIP_WASM_OPT=1 skips that pass for local dev and is refused when CI=true.

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

# rustc 1.99.0 target features for wasm32-unknown-unknown (`rustc --print cfg`).
# simd is not in that set.
WASM_OPT_FEATURES=(
  --enable-bulk-memory
  --enable-multivalue
  --enable-mutable-globals
  --enable-nontrapping-float-to-int
  --enable-reference-types
  --enable-sign-ext
)

SKIP_WASM_OPT=0

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

# shellcheck source=lib-wasm-pin.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-wasm-pin.sh"

# Official archives print "wasm-opt version 133 (version_133)".
# A source build of tag version_133, including Homebrew, prints "wasm-opt version 133".
parse_wasm_opt_version() {
  local text="$1"
  local num="" paren=""
  if [[ "$text" =~ ^wasm-opt\ version\ ([0-9]+)(\ \(version_([0-9]+)\))?$ ]]; then
    num="${BASH_REMATCH[1]}"
    paren="${BASH_REMATCH[3]}"
    if [ -n "$paren" ] && [ "$paren" != "$num" ]; then
      return 1
    fi
    printf '%s\n' "$num"
    return 0
  fi
  return 1
}

# Check prerequisites
check_prerequisites() {
  if ! command -v wasm-pack >/dev/null 2>&1; then
    log_error "wasm-pack is not installed. Install with: cargo install wasm-pack --version $(read_pin wasmPack) --locked"
    exit 1
  fi

  local rust_pin pack_pin opt_pin rust_got pack_got
  rust_pin="$(read_pin rust)"
  pack_pin="$(read_pin wasmPack)"
  opt_pin="$(read_pin wasmOpt)"
  rust_got="$(rustc --version | awk '{print $2}')"
  pack_got="$(wasm-pack --version | awk '{print $2}')"
  if [ "$rust_got" != "$rust_pin" ]; then
    log_error "rustc ${rust_got} != wasm-size.json toolchain.rust ${rust_pin}"
    exit 1
  fi
  if [ "$pack_got" != "$pack_pin" ]; then
    log_error "wasm-pack ${pack_got} != wasm-size.json toolchain.wasmPack ${pack_pin}"
    exit 1
  fi

  if [ "${GWEN_SKIP_WASM_OPT:-}" = "1" ]; then
    if [ "${CI:-}" = "true" ]; then
      log_error "GWEN_SKIP_WASM_OPT is refused when CI=true"
      exit 1
    fi
    echo "wasm-opt skipped (GWEN_SKIP_WASM_OPT=1)"
    SKIP_WASM_OPT=1
    return
  fi

  if ! command -v wasm-opt >/dev/null 2>&1; then
    log_error "wasm-opt ${opt_pin} is not installed."
    log_error "Install the official archive and put its bin directory on PATH."
    log_error "macOS arm64: https://github.com/WebAssembly/binaryen/releases/download/version_${opt_pin}/binaryen-version_${opt_pin}-arm64-macos.tar.gz"
    log_error "macOS x86_64: https://github.com/WebAssembly/binaryen/releases/download/version_${opt_pin}/binaryen-version_${opt_pin}-x86_64-macos.tar.gz"
    log_error "Linux x86_64: https://github.com/WebAssembly/binaryen/releases/download/version_${opt_pin}/binaryen-version_${opt_pin}-x86_64-linux.tar.gz"
    log_error "Check the download with shasum -a 256 -c (macOS) or sha256sum -c (Linux). The sha256 values are in wasm-size.json."
    log_error "Local escape hatch: GWEN_SKIP_WASM_OPT=1 (refused when CI=true)."
    exit 1
  fi
  local opt_text opt_got
  opt_text="$(wasm-opt --version | tr -d '\r')"
  if ! opt_got="$(parse_wasm_opt_version "$opt_text")"; then
    log_error "wasm-opt --version '${opt_text}' is not pinned ${opt_pin}"
    exit 1
  fi
  if [ "$opt_got" != "$opt_pin" ]; then
    log_error "wasm-opt --version '${opt_text}' is not pinned ${opt_pin}"
    exit 1
  fi
  log_success "wasm-opt ${opt_pin} matches wasm-size.json"
}

optimize_wasm() {
  local wasm_file="$1"
  local label="$2"
  if [ "$SKIP_WASM_OPT" = "1" ]; then
    return
  fi
  log_info "  Running wasm-opt -Oz on ${label}"
  wasm-opt -Oz "${WASM_OPT_FEATURES[@]}" "$wasm_file" -o "$wasm_file.opt"
  mv "$wasm_file.opt" "$wasm_file"
}

write_toolchain_stamp() {
  local rust_got pack_got opt_value
  rust_got="$(rustc --version | awk '{print $2}')"
  pack_got="$(wasm-pack --version | awk '{print $2}')"
  if [ "$SKIP_WASM_OPT" = "1" ]; then
    opt_value="skipped"
  else
    local opt_text
    opt_text="$(wasm-opt --version | tr -d '\r')"
    if ! opt_value="$(parse_wasm_opt_version "$opt_text")"; then
      opt_value="missing"
    fi
  fi
  mkdir -p "$ENGINE_CORE_WASM"
  python3 - "$ENGINE_CORE_WASM/toolchain.json" "$rust_got" "$pack_got" "$opt_value" <<'PY'
import json, sys
path, rust, pack, opt = sys.argv[1:]
with open(path, "w", encoding="utf-8") as handle:
    json.dump({"rust": rust, "wasmPack": pack, "wasmOpt": opt}, handle, indent=2)
    handle.write("\n")
PY
  if command -v node >/dev/null 2>&1; then
    node "$PROJECT_ROOT/scripts/check-wasm-size.mjs" --write-report-only
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

  # Build with wasm-pack. --no-opt keeps wasm-pack's own wasm-opt off.
  local feature_args=""
  if [ -n "$features" ]; then
    feature_args="-- --features $features"
  else
    feature_args="-- --no-default-features"
  fi

  wasm-pack build "$CRATE_DIR" \
    --target web \
    --release \
    --no-opt \
    --out-dir "$out_dir" \
    --out-name gwen_core \
    $feature_args

  # Cleanup wasm-pack noise
  rm -f "$out_dir/.gitignore" "$out_dir/package.json" "$out_dir/README.md"

  optimize_wasm "$out_dir/gwen_core_bg.wasm" "$variant"

  # Per-instance glue. Only build_variant calls this, so BVH and build-tools stay raw.
  node "$PROJECT_ROOT/scripts/wasm-factory.mjs" "$out_dir"

  log_success "Built $variant variant"
  ls -lh "$out_dir" | awk '{print "    - " $9 " (" $5 ")"}'
}

# Main
main() {
  if [ "${GWEN_WRITE_STAMP_ONLY:-}" = "1" ]; then
    write_toolchain_stamp
    exit 0
  fi

  log_info "🚀 Starting Multi-Variant WASM Build Pipeline (RFC-V2-006)"
  echo ""

  check_prerequisites
  if [ "${GWEN_WASM_OPT_CHECK_ONLY:-}" = "1" ]; then
    exit 0
  fi
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

  # Build Node.js target for Vite plugin build-tools. Not a browser binary.
  log_info "Building gwen-core build-tools (Node.js target)..."
  wasm-pack build "$CRATE_DIR" \
    --target nodejs \
    --release \
    --no-opt \
    --out-dir "$PROJECT_ROOT/packages/physics3d/build-tools" \
    --out-name gwen_core \
    -- --features "build-tools" --no-default-features 2>&1

  # Clean up wasm-pack Node.js artifacts we don't need
  rm -f "$PROJECT_ROOT/packages/physics3d/build-tools/.gitignore"
  log_info "Build-tools WASM built successfully"
  echo ""

  # Build web target for browser BVH worker
  log_info "Building gwen-core BVH worker (web target)..."
  local bvh_out_dir="$PROJECT_ROOT/packages/physics3d/wasm/bvh"
  rm -rf "$bvh_out_dir"
  mkdir -p "$bvh_out_dir"

  wasm-pack build "$CRATE_DIR" \
    --target web \
    --release \
    --no-opt \
    --out-dir "$bvh_out_dir" \
    --out-name gwen_core \
    -- --features "build-tools" --no-default-features 2>&1

  rm -f "$bvh_out_dir/.gitignore" "$bvh_out_dir/package.json" "$bvh_out_dir/README.md"

  optimize_wasm "$bvh_out_dir/gwen_core_bg.wasm" "bvh"

  log_info "BVH worker WASM built successfully"
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
      --no-opt \
      --out-dir "$out_dir" \
      --out-name gwen_physics3d_fracture

    rm -f "$out_dir/.gitignore" "$out_dir/package.json" "$out_dir/README.md"

    optimize_wasm "$out_dir/gwen_physics3d_fracture_bg.wasm" "fracture"

    log_success "Built fracture variant"
    ls -lh "$out_dir" | awk '{print "    - " $9 " (" $5 ")"}'
  }
  build_fracture
  echo ""

  write_toolchain_stamp

  log_success "🎉 All WASM variants built successfully!"
}

main "$@"
