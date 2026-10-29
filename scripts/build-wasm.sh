#!/bin/bash
# build-wasm.sh — Build multi-variant WASM artifacts (RFC-V2-006)
#
# Builds the browser variants, a dev-checked copy of each, the Node build-tools
# binary, the BVH worker, and the fracture module. Every browser binary is
# optimised with the wasm-opt version pinned in wasm-size.json.
# GWEN_SKIP_WASM_OPT=1 skips that pass for local dev and is refused when CI=true.
# GWEN_DRY_RUN=1 prints the commands and does not run them, delete outputs, or write the stamp.
# RUSTFLAGS and CARGO_TARGET_DIR from the environment are overridden for each build.

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
# simd is not in that set. A cell may add +simd128 through the variant row.
WASM_OPT_FEATURES=(
  --enable-bulk-memory
  --enable-multivalue
  --enable-mutable-globals
  --enable-nontrapping-float-to-int
  --enable-reference-types
  --enable-sign-ext
)

SKIP_WASM_OPT=0
ONLY=""
CELL=""

# profile|cargo-opt|target-feature|rapier-simd|wasm-opt
# rapier-simd 1 enables Rapier's `simd8` feature (there is no `simd-stable`).
# --cell stores one override row. CELL_FOR is one variant, or * for all three.
CELL_FOR=""
CELL_ROW=""

variant_row() {
  local name="$1"
  local row="release|||0|-Oz"
  case "$name" in
    light|physics2d|physics3d) ;;
    *) return 1 ;;
  esac
  if [ -n "$CELL_ROW" ]; then
    case "$CELL_FOR" in
      "*"|"$name") row="$CELL_ROW" ;;
    esac
  fi
  printf '%s\n' "$row"
}

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

# Print argv and the cargo env this build sets. GWEN_DRY_RUN=1 returns before exec.
run() {
  printf 'run argv:'
  local arg
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
  printf 'run env: RUSTFLAGS=%q CARGO_PROFILE_RELEASE_OPT_LEVEL=%q CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS=%q CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS=%q CARGO_TARGET_DIR=%q\n' \
    "${RUSTFLAGS-}" \
    "${CARGO_PROFILE_RELEASE_OPT_LEVEL-}" \
    "${CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS-}" \
    "${CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS-}" \
    "${CARGO_TARGET_DIR-}"
  if [ "${GWEN_DRY_RUN:-}" = "1" ]; then
    return 0
  fi
  "$@"
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

row_field() {
  local row=""
  local index="$2"
  local i=0
  row="$(variant_row "$1")"
  while [ "$i" -lt "$index" ]; do
    row="${row#*|}"
    i=$((i + 1))
  done
  printf '%s' "${row%%|*}"
}

# Both remap flags on every wasm-pack. A non-empty target feature is appended.
rustflags_for() {
  local variant="${1:-}"
  local flags="--remap-path-prefix=${PROJECT_ROOT}=/gwen --remap-path-prefix=${CARGO_HOME:-${HOME}/.cargo}=/cargo"
  if [ -n "$variant" ]; then
    local target
    target="$(row_field "$variant" 2)"
    if [ -n "$target" ]; then
      flags="${flags} -C target-feature=${target}"
    fi
  fi
  printf '%s' "$flags"
}

# opt, debug-assertions, overflow-checks and CARGO_TARGET_DIR stay unset unless set.
pack_wasm() {
  local rustflags="$1"
  local opt_level="$2"
  local debug_assertions="$3"
  local overflow_checks="$4"
  local cargo_target="$5"
  shift 5
  (
    unset CARGO_PROFILE_RELEASE_OPT_LEVEL
    unset CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS
    unset CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS
    unset CARGO_TARGET_DIR
    export RUSTFLAGS="$rustflags"
    if [ -n "$opt_level" ]; then export CARGO_PROFILE_RELEASE_OPT_LEVEL="$opt_level"; fi
    if [ -n "$debug_assertions" ]; then export CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS="$debug_assertions"; fi
    if [ -n "$overflow_checks" ]; then export CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS="$overflow_checks"; fi
    if [ -n "$cargo_target" ]; then export CARGO_TARGET_DIR="$cargo_target"; fi
    run "$@"
  )
}

optimize_wasm() {
  local wasm_file="$1"
  local label="$2"
  local level="${3:--Oz}"
  if [ "$SKIP_WASM_OPT" = "1" ]; then
    return
  fi
  log_info "  Running wasm-opt ${level} on ${label}"
  run wasm-opt "$level" ${WASM_OPT_FEATURES[@]+"${WASM_OPT_FEATURES[@]}"} "$wasm_file" -o "$wasm_file.opt"
  if [ "${GWEN_DRY_RUN:-}" = "1" ]; then
    return
  fi
  mv "$wasm_file.opt" "$wasm_file"
}

prepare_out_dir() {
  if [ "${GWEN_DRY_RUN:-}" = "1" ]; then
    return
  fi
  rm -rf "$1"
  mkdir -p "$1"
}

clean_out() {
  if [ "${GWEN_DRY_RUN:-}" = "1" ]; then
    return
  fi
  rm -f "$1/.gitignore" "$1/package.json" "$1/README.md"
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

# Stamp gwen.build, then the per-instance factory. BVH and build-tools do not call this.
finish_variant() {
  local out_dir="$1"
  local label="$2"
  run node "$PROJECT_ROOT/scripts/wasm-build-id.mjs" "$out_dir/gwen_core_bg.wasm"
  run node "$PROJECT_ROOT/scripts/wasm-factory.mjs" "$out_dir"
  if [ "${GWEN_DRY_RUN:-}" = "1" ]; then
    return
  fi
  log_success "Built ${label}"
  ls -lh "$out_dir" | awk '{print "    - " $9 " (" $5 ")"}'
}

# dev=1 is the checked core. Release and dev share this body, pack_wasm and finish_variant.
build_variant() {
  local variant="$1"
  local features="$2"
  local dev="${3:-0}"
  local label="$variant"
  local out_dir="$ENGINE_CORE_WASM/$variant"
  local opt_level debug_assertions="" overflow_checks="" cargo_target="" level packed extra=""
  opt_level="$(row_field "$variant" 1)"
  level="$(row_field "$variant" 4)"
  if [ "$dev" = "1" ]; then
    label="${variant}-dev"
    out_dir="$ENGINE_CORE_WASM/${variant}-dev"
    opt_level="1"
    debug_assertions="true"
    overflow_checks="true"
    # Separate from the release target dir so the two profiles do not share a cache.
    cargo_target="$PROJECT_ROOT/target/dev-checked"
    level="-O1"
  fi
  if [ "$(row_field "$variant" 3)" = "1" ]; then
    case "$variant" in
      physics2d) extra="physics2d-simd" ;;
      physics3d) extra="physics3d-simd" ;;
    esac
  fi
  if [ -n "$extra" ]; then
    if [ -n "$features" ]; then packed="${features},${extra}"; else packed="$extra"; fi
  else
    packed="$features"
  fi
  local -a cargo_tail=(--no-default-features)
  if [ -n "$packed" ]; then cargo_tail=(--features "$packed"); fi
  log_info "Building variant: ${label} ($(row_field "$variant" 0))"
  prepare_out_dir "$out_dir"
  pack_wasm "$(rustflags_for "$variant")" "$opt_level" "$debug_assertions" "$overflow_checks" "$cargo_target" \
    wasm-pack build "$CRATE_DIR" --target web --release --no-opt \
    --out-dir "$out_dir" --out-name gwen_core -- ${cargo_tail[@]+"${cargo_tail[@]}"}
  clean_out "$out_dir"
  optimize_wasm "$out_dir/gwen_core_bg.wasm" "$label" "$level"
  finish_variant "$out_dir" "$label"
}

build_dev_variant() {
  build_variant "$1" "$2" 1
}

apply_cell() {
  local cell="$1"
  local variant="$2"
  local profile="${cell%%:*}"
  local simd="${cell#*:}"
  local prof="release" cargo="" target="" rapier=0 wopt="-Oz"
  case "$profile" in
    P1) cargo="z" ;;
    P2) prof="release-fast"; cargo="3"; wopt="-O3" ;;
    P3) cargo="3"; wopt="-Os" ;;
  esac
  case "$simd" in
    S1|S1R) target="+simd128" ;;
  esac
  if [ "$simd" = "S1R" ]; then rapier=1; fi
  if [ -n "$CELL_FOR" ] && [ "$CELL_FOR" != "$variant" ]; then
    CELL_FOR="*"
  else
    CELL_FOR="$variant"
  fi
  CELL_ROW="${prof}|${cargo}|${target}|${rapier}|${wopt}"
}

build_node_tools() {
  log_info "Building gwen-core build-tools (Node.js target)..."
  pack_wasm "$(rustflags_for)" "" "" "" "" \
    wasm-pack build "$CRATE_DIR" --target nodejs --release --no-opt \
    --out-dir "$PROJECT_ROOT/packages/physics3d/build-tools" --out-name gwen_core \
    -- --features "build-tools" --no-default-features
  if [ "${GWEN_DRY_RUN:-}" != "1" ]; then
    rm -f "$PROJECT_ROOT/packages/physics3d/build-tools/.gitignore"
  fi
  log_info "Build-tools WASM built successfully"
}

build_bvh() {
  local bvh_out_dir="$PROJECT_ROOT/packages/physics3d/wasm/bvh"
  log_info "Building gwen-core BVH worker (web target)..."
  prepare_out_dir "$bvh_out_dir"
  pack_wasm "$(rustflags_for)" "" "" "" "" \
    wasm-pack build "$CRATE_DIR" --target web --release --no-opt \
    --out-dir "$bvh_out_dir" --out-name gwen_core \
    -- --features "build-tools" --no-default-features
  clean_out "$bvh_out_dir"
  optimize_wasm "$bvh_out_dir/gwen_core_bg.wasm" "bvh" "-Oz"
  log_info "BVH worker WASM built successfully"
}

build_fracture() {
  local out_dir="$PROJECT_ROOT/packages/physics3d-fracture/wasm"
  local crate_dir="$PROJECT_ROOT/crates/gwen-physics3d-fracture"
  log_info "Building fracture variant (gwen-physics3d-fracture)"
  prepare_out_dir "$out_dir"
  pack_wasm "$(rustflags_for)" "" "" "" "" \
    wasm-pack build "$crate_dir" --target web --release --no-opt \
    --out-dir "$out_dir" --out-name gwen_physics3d_fracture
  clean_out "$out_dir"
  optimize_wasm "$out_dir/gwen_physics3d_fracture_bg.wasm" "fracture" "-Oz"
  if [ "${GWEN_DRY_RUN:-}" = "1" ]; then
    return
  fi
  log_success "Built fracture variant"
  ls -lh "$out_dir" | awk '{print "    - " $9 " (" $5 ")"}'
}

# Main
main() {
  ONLY=""
  CELL=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --only)
        if [ "$#" -lt 2 ]; then
          printf 'unknown variant: %s\n' "--only" >&2
          exit 1
        fi
        ONLY="$2"
        shift 2
        ;;
      --cell)
        CELL="${2-}"
        case "$CELL" in
          P1:S0|P1:S1|P1:S1R|P2:S0|P2:S1|P2:S1R|P3:S0|P3:S1|P3:S1R) ;;
          *) printf 'unknown cell: %s\n' "${CELL:---cell}" >&2; exit 1 ;;
        esac
        shift
        if [ "$#" -gt 0 ]; then shift; fi
        ;;
      *)
        printf 'unknown argument: %s\n' "$1" >&2
        exit 1
        ;;
    esac
  done
  case "$ONLY" in
    ""|light|physics2d|physics3d) ;;
    *)
      printf 'unknown variant: %s\n' "$ONLY" >&2
      exit 1
      ;;
  esac

  if [ "${GWEN_WRITE_STAMP_ONLY:-}" = "1" ]; then
    write_toolchain_stamp
    exit 0
  fi

  log_info "🚀 Starting Multi-Variant WASM Build Pipeline (RFC-V2-006)"
  echo ""

  if [ "${GWEN_DRY_RUN:-}" != "1" ]; then
    check_prerequisites
  fi
  if [ "${GWEN_WASM_OPT_CHECK_ONLY:-}" = "1" ]; then
    exit 0
  fi
  echo ""

  local with_dev=1
  local with_tools=1
  if [ -n "$ONLY" ] || [ -n "$CELL" ]; then
    with_dev=0
    with_tools=0
  fi
  if [ -n "$CELL" ]; then
    if [ -n "$ONLY" ]; then
      apply_cell "$CELL" "$ONLY"
    else
      apply_cell "$CELL" "light"
      apply_cell "$CELL" "physics2d"
      apply_cell "$CELL" "physics3d"
    fi
  fi

  local variant features index=0
  local names=(light physics2d physics3d)
  local feature_list=("" physics2d physics3d)
  for variant in ${names[@]+"${names[@]}"}; do
    features="${feature_list[$index]}"
    index=$((index + 1))
    if [ -n "$ONLY" ] && [ "$ONLY" != "$variant" ]; then
      continue
    fi
    build_variant "$variant" "$features"
    if [ "$with_dev" = "1" ]; then
      build_dev_variant "$variant" "$features"
    fi
    echo ""
  done

  if [ "$with_tools" = "1" ]; then
    build_node_tools
    echo ""
    build_bvh
    echo ""
    build_fracture
    echo ""
  fi

  if [ "${GWEN_DRY_RUN:-}" != "1" ]; then
    write_toolchain_stamp
  fi

  log_success "🎉 All WASM variants built successfully!"
}

main "$@"
