#!/bin/bash
# build-wasm-tools.sh — Build ONLY the physics3d build-tools WASM (Node.js target)
#
# This builds gwen-core with --features build-tools --target nodejs.
# Used by the physics3d Vite plugin at build time (not at runtime).
#
# Run this once after cloning, or whenever crates/gwen-core changes.
# Full WASM build (all variants): ./scripts/build-wasm.sh

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="$PROJECT_ROOT/crates/gwen-core"
OUT_DIR="$PROJECT_ROOT/packages/physics3d/build-tools"

# shellcheck source=lib-wasm-pin.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-wasm-pin.sh"

if ! command -v wasm-pack &> /dev/null; then
  echo "❌ wasm-pack is not installed."
  echo "   Install with: cargo install wasm-pack --version $(read_pin wasmPack) --locked"
  exit 1
fi

pack_pin="$(read_pin wasmPack)"
pack_got="$(wasm-pack --version | awk '{print $2}')"
if [ "$pack_got" != "$pack_pin" ]; then
  echo "wasm-pack ${pack_got} != wasm-size.json toolchain.wasmPack ${pack_pin}"
  exit 1
fi

echo "ℹ Building gwen-core build-tools (Node.js target)..."
wasm-pack build "$CRATE_DIR" \
  --target nodejs \
  --release \
  --out-dir "$OUT_DIR" \
  -- --features "build-tools" --no-default-features

rm -f "$OUT_DIR/.gitignore"
echo "✓ build-tools WASM ready at packages/physics3d/build-tools/"
