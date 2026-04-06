#!/bin/bash
# clean-cargo.sh — Build/check/test Rust crates with controllable cache invalidation
#
# Usage:
#   ./scripts/clean-cargo.sh [command] [target] [mode]
#
# Commands:
#   check       (default)
#   build       (release)
#   build-debug
#   test
#   clean
#   watch
#
# Targets:
#   wasm32-unknown-unknown (default)
#   native                 (host target; no --target flag passed)
#
# Modes:
#   smart      (default)   incremental-friendly, no global cargo clean
#   aggressive             force fresh compile with cargo clean before action

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATES_DIR="$PROJECT_ROOT/crates"

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

find_crates() {
  find "$CRATES_DIR" -maxdepth 2 -name "Cargo.toml" -type f | sort
}

get_cpu_count() {
  if command -v nproc &>/dev/null; then
    nproc
  elif command -v sysctl &>/dev/null; then
    sysctl -n hw.ncpu
  else
    echo 4
  fi
}

# Read package name from Cargo.toml [package] section.
# Falls back to folder name if parsing fails.
crate_name_from_manifest() {
  local manifest="$1"
  local fallback
  fallback="$(basename "$(dirname "$manifest")")"

  local name
  name="$(awk '
    /^\[package\]$/ { in_pkg=1; next }
    /^\[/ { if (in_pkg) exit }
    in_pkg && /^name\s*=\s*"/ {
      gsub(/^name\s*=\s*"/, "", $0)
      gsub(/"\s*$/, "", $0)
      print $0
      exit
    }
  ' "$manifest")"

  if [ -n "${name:-}" ]; then
    echo "$name"
  else
    echo "$fallback"
  fi
}

# Build cargo args for target handling.
# If target is "native", return empty args (host build).
cargo_target_args() {
  local target="$1"
  if [ "$target" = "native" ]; then
    echo ""
  else
    echo "--target $target"
  fi
}

# Clean generated artifacts for one crate (without touching Cargo.lock).
clean_crate_artifacts() {
  local manifest="$1"
  local dir
  dir="$(dirname "$manifest")"

  [ -d "$dir/pkg" ] && rm -rf "$dir/pkg"
  find "$dir" -maxdepth 1 -name "*.wasm" -delete
  find "$dir" -maxdepth 1 -name "*_bg.js" -delete
  find "$dir" -maxdepth 1 -name "*.d.ts" -delete
}

build_crate() {
  local manifest="$1"
  local target="$2"
  local profile="$3"
  local name
  name="$(crate_name_from_manifest "$manifest")"
  local target_args
  target_args="$(cargo_target_args "$target")"
  local start_time
  start_time="$(date +%s%N)"

  log_info "Building $name (target: $target, profile: $profile)..."

  if [ "$profile" = "debug" ]; then
    if [ -n "$target_args" ]; then
      cargo build -p "$name" $target_args 2>&1 || {
        log_error "Build failed for $name"
        return 1
      }
    else
      cargo build -p "$name" 2>&1 || {
        log_error "Build failed for $name"
        return 1
      }
    fi
  else
    if [ -n "$target_args" ]; then
      cargo build -p "$name" $target_args --release 2>&1 || {
        log_error "Build failed for $name"
        return 1
      }
    else
      cargo build -p "$name" --release 2>&1 || {
        log_error "Build failed for $name"
        return 1
      }
    fi
  fi

  local end_time
  end_time="$(date +%s%N)"
  local duration_ms=$(((end_time - start_time) / 1000000))
  log_success "Built $name (${duration_ms}ms)"
}

test_crate() {
  local manifest="$1"
  local name
  name="$(crate_name_from_manifest "$manifest")"
  local start_time
  start_time="$(date +%s%N)"

  log_info "Testing $name..."
  cargo test -p "$name" 2>&1 || {
    log_error "Tests failed for $name"
    return 1
  }

  local end_time
  end_time="$(date +%s%N)"
  local duration_ms=$(((end_time - start_time) / 1000000))
  log_success "Tests passed for $name (${duration_ms}ms)"
}

check_crate() {
  local manifest="$1"
  local target="$2"
  local name
  name="$(crate_name_from_manifest "$manifest")"
  local target_args
  target_args="$(cargo_target_args "$target")"
  local start_time
  start_time="$(date +%s%N)"

  log_info "Checking $name (target: $target)..."
  if [ -n "$target_args" ]; then
    cargo check -p "$name" $target_args 2>&1 || {
      log_error "Check failed for $name"
      return 1
    }
  else
    cargo check -p "$name" 2>&1 || {
      log_error "Check failed for $name"
      return 1
    }
  fi

  local end_time
  end_time="$(date +%s%N)"
  local duration_ms=$(((end_time - start_time) / 1000000))
  log_success "Checked $name (${duration_ms}ms)"
}

main() {
  local command="${1:-check}"
  local target="${2:-wasm32-unknown-unknown}"
  local mode="${3:-smart}"

  # Find all crates
  local crates=()
  while IFS= read -r manifest; do
    crates+=("$manifest")
  done < <(find_crates)

  if [ ${#crates[@]} -eq 0 ]; then
    log_warn "No crates found in $CRATES_DIR"
    exit 1
  fi

  log_info "Found ${#crates[@]} crate(s)"
  for manifest in "${crates[@]}"; do
    local dir name
    dir="$(dirname "$manifest")"
    name="$(crate_name_from_manifest "$manifest")"
    echo "  - $name ($dir)"
  done
  echo

  local cpu_count
  cpu_count="$(get_cpu_count)"
  log_info "Using $cpu_count CPU core(s)"
  log_info "Mode: $mode"
  echo

  # Aggressive mode: full workspace clean before action
  if [ "$mode" = "aggressive" ] && [ "$command" != "watch" ]; then
    log_info "Aggressive mode: running workspace cargo clean..."
    cargo clean
  fi

  case "$command" in
    check)
      log_info "Starting CHECK workflow..."
      for manifest in "${crates[@]}"; do
        clean_crate_artifacts "$manifest"
        check_crate "$manifest" "$target" || exit 1
      done
      log_success "All crates checked successfully!"
      ;;

    build)
      log_info "Starting BUILD workflow (release)..."
      for manifest in "${crates[@]}"; do
        clean_crate_artifacts "$manifest"
        build_crate "$manifest" "$target" "release" || exit 1
      done
      log_success "All crates built successfully!"
      ;;

    build-debug)
      log_info "Starting BUILD workflow (debug)..."
      for manifest in "${crates[@]}"; do
        clean_crate_artifacts "$manifest"
        build_crate "$manifest" "$target" "debug" || exit 1
      done
      log_success "All crates built successfully (debug)!"
      ;;

    test)
      log_info "Starting TEST workflow..."
      for manifest in "${crates[@]}"; do
        clean_crate_artifacts "$manifest"
        test_crate "$manifest" || exit 1
      done
      log_success "All crates tested successfully!"
      ;;

    clean)
      log_info "Cleaning workspace artifacts..."
      cargo clean
      for manifest in "${crates[@]}"; do
        clean_crate_artifacts "$manifest"
      done
      log_success "All cleaned!"
      ;;

    watch)
      local target_args
      target_args="$(cargo_target_args "$target")"
      log_info "Starting cargo watch (target: $target)..."
      if [ -n "$target_args" ]; then
        cargo watch --exec "build --release $target_args" --ignore "*.d.ts" --ignore "*.wasm"
      else
        cargo watch --exec "build --release" --ignore "*.d.ts" --ignore "*.wasm"
      fi
      ;;

    *)
      echo "Usage: $0 {check|build|build-debug|test|clean|watch} [target] [mode]"
      echo
      echo "Commands:"
      echo "  check       — cargo check all crates (default)"
      echo "  build       — cargo build --release all crates"
      echo "  build-debug — cargo build (debug) all crates"
      echo "  test        — cargo test all crates"
      echo "  clean       — cargo clean + artifacts cleanup"
      echo "  watch       — cargo watch"
      echo
      echo "Target:"
      echo "  wasm32-unknown-unknown (default)"
      echo "  native"
      echo
      echo "Mode:"
      echo "  smart      (default, no global cargo clean)"
      echo "  aggressive (runs cargo clean before check/build/test)"
      echo
      echo "Examples:"
      echo "  ./scripts/clean-cargo.sh check"
      echo "  ./scripts/clean-cargo.sh build wasm32-unknown-unknown smart"
      echo "  ./scripts/clean-cargo.sh build native aggressive"
      echo "  ./scripts/clean-cargo.sh test wasm32-unknown-unknown aggressive"
      exit 1
      ;;
  esac
}

main "$@"
