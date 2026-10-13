# WASM & Crate Builds

## Overview

GWEN compiles Rust crates to WebAssembly (`.wasm`) for use in the TypeScript layer. Three build variants exist, controlled by Cargo feature flags.

## Build Variants

### light
- **What it includes:** ECS core, transform hierarchy, spatial queries
- **No physics** — smallest binary
- **Use case:** Engine without physics, custom physics integration

### physics2d (default)
- **What it includes:** ECS core, transform hierarchy, Rapier 2D physics
- **Physics2D**: 2D rigid bodies, collisions, joints, constraints
- **Use case:** 2D games, default build

### physics3d
- **What it includes:** ECS core, transform hierarchy, Rapier 3D physics, fracture simulation
- **Physics3D**: 3D rigid bodies, collisions, joints, constraints, destructible objects
- **Requires:** `build-tools` feature flag for fracture simulation
- **Use case:** 3D games with destructible environments

## Build Process

### Building WASM Locally

```bash
# Build default variant (physics2d)
pnpm build:wasm

# Debug variant with optimizations
pnpm build:cargo

# Watch and rebuild on changes (while developing)
pnpm dev
```

The `build-wasm.sh` script needs Rust 1.99.0, wasm-pack 0.13.1, and wasm-opt 133. It:
1. Refuses to run when `rustc`, `wasm-pack`, or `wasm-opt` is not the pinned version (`wasm-opt version 133 (version_133)`, or `wasm-opt version 133` from a source build of that tag)
2. Builds each browser variant with `wasm-pack --no-opt`
3. Runs `wasm-opt -Oz` on every browser binary, including bvh and fracture
4. Writes `packages/core/wasm/toolchain.json` with the observed rustc, wasm-pack, and wasm-opt versions

`GWEN_SKIP_WASM_OPT=1` skips the `wasm-opt` pass on a laptop and is refused when `CI=true`.

### Build Tools Variant

```bash
# Build physics3d with fracture simulation
pnpm build:wasm:tools

# This requires the `build-tools` feature in physics3d crate
```

The `build-wasm-tools.sh` script handles the specialized build for fracture physics.

## Output Locations

After building, WASM output appears at:

```
packages/core/wasm/
├── index.wasm              # ECS core binary
└── index.d.ts              # TypeScript bindings

packages/physics2d/wasm/
├── index.wasm              # Physics2D binary
└── index.d.ts

packages/physics3d/wasm/
├── index.wasm              # Physics3D binary
├── index_tools.wasm        # Physics3D + fracture
└── index.d.ts
```

TypeScript packages import these bindings:
```typescript
import * as wasm from '../wasm/index.wasm';
```

## Git Handling

### Gitignore
WASM binaries are **not committed** to the repository:

```gitignore
packages/*/wasm/*.wasm
```

This keeps the repository size small.

### Building Before Publish

The **CI publish workflow**:
1. Builds all WASM variants
2. Includes `.wasm` files in npm package tarballs
3. Generated bindings (`.d.ts`) are included

Users installing from npm get prebuilt binaries. Local development requires running `pnpm build:wasm`.

## Development Workflow

### First Time Setup

```bash
# Install dependencies + build WASM
pnpm install:all

# Or separately:
pnpm install
pnpm build:wasm
pnpm build:ts
```

### During Development

```bash
# Watch Rust + TypeScript
pnpm dev

# This runs:
# - cargo watch (rebuilds Rust on file change)
# - pnpm dev:ts (rebuilds TS packages in watch mode)
```

### Building a Specific Variant

```bash
# Build only core ECS (light variant)
cd crates/gwen-core
wasm-pack build --target web

# Build physics2d
cd crates/gwen-physics2d
wasm-pack build --target web

# Build physics3d with tools
cd crates/gwen-physics3d
wasm-pack build --target web --features build-tools
```

## Binary Size

Shipped browser binaries are optimised with the `wasm-opt` version pinned in `wasm-size.json`.
`pnpm check:wasm-size` compares each variant with that file.
The Node build-tools binary is reported in the CI step summary and is not gated.

## Troubleshooting

### "WASM file not found"
```bash
# Build WASM first
pnpm build:wasm
```

### Memory issues during build
```bash
# Clean cargo cache and rebuild
pnpm clean
pnpm install:all
```

### Rust compile errors
```bash
# Update Rust toolchain
rustup update
rustup target add wasm32-unknown-unknown

# Clean build
cargo clean
pnpm build:wasm
```

### Verify memory layout
```bash
# Check that TS/Rust memory alignment matches
node scripts/verify-memory-layout.mjs
```

## Memory Layout & Unsafe Code

The WASM bridge uses `unsafe` code for:
- Direct memory access via shared ArrayBuffers
- Structure-of-Arrays (SoA) alignment assumptions
- Ring buffer pointers

Every non-test `unsafe` site has an id in the crate's `UNSAFE.md`. `pnpm check:unsafe` checks the ids.

See the `gwen-wasm-utils` crate for WASM utility implementations.

## CI Build Process

The GitHub Actions workflow (`ci.yml`):
1. Installs Rust 1.99.0, wasm-pack 0.13.1, and wasm-opt 133. The wasm-opt archive sha256 is checked from `wasm-size.json`.
2. Runs `./scripts/build-wasm.sh`, which applies `wasm-opt -Oz` to every browser binary
3. Builds the Node build-tools binary inside `./scripts/build-wasm.sh`, which checks wasm-pack against `wasm-size.json`. CI does not run `pnpm build:wasm:tools`. `scripts/build-wasm-tools.sh` still does not check the wasm-pack version.
4. Uploads the WASM artifacts for the publish workflow
5. Publishes npm packages with embedded WASM. `toolchain.json` is not part of the `@gwenjs/core` package.

This ensures end users never need to build WASM locally.
