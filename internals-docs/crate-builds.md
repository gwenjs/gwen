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

The `build-wasm-tools.sh` script handles the specialized build for fracture physics. It checks `wasm-pack` against `toolchain.wasmPack` in `wasm-size.json` before `wasm-pack build`.

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

## Dev-checked variants

`pnpm build:wasm` also writes `packages/core/wasm/<variant>-dev/` for `light`, `physics2d` and `physics3d`.
That build uses opt-level 1, debug assertions and overflow checks.
`[profile.dev-checked]` in the workspace `Cargo.toml` records the same settings.
wasm-pack cannot select that profile, so `scripts/build-wasm.sh` sets `CARGO_PROFILE_RELEASE_OPT_LEVEL`, `CARGO_PROFILE_RELEASE_DEBUG_ASSERTIONS` and `CARGO_PROFILE_RELEASE_OVERFLOW_CHECKS`.
The dev build uses `CARGO_TARGET_DIR` `target/dev-checked`, so it does not reuse the release cache.
`wasm-opt` runs at `-O1` and keeps the same `--enable-*` list as the release binaries.
`scripts/build-wasm.sh` overrides `RUSTFLAGS` and `CARGO_TARGET_DIR` from the environment for each build.

## Profile matrix

Run it by hand. It is not a `ci-status` job (`.github/workflows/ci.yml:884`). Ticket `#93`.

```bash
gh workflow run wasm-profile-matrix.yml --ref <branch>
```

`.github/workflows/wasm-profile-matrix.yml:4` is `workflow_dispatch` only. `permissions` is `contents: read` (`.github/workflows/wasm-profile-matrix.yml:7`). The job sets `timeout-minutes: 360` (`.github/workflows/wasm-profile-matrix.yml:14`).

The benches load wasm glue, not `dist` (`packages/core/bench/simulation-wasm.bench.ts:30`, `packages/core/bench/shared-memory.bench.ts:51`). The physics bench builds its scene in `setup` (`packages/core/bench/physics-step-wasm.bench.ts:28`) and loads that variant's factory then (`packages/core/bench/fixtures/physics-step-scene.ts:129`). The job does not compile TypeScript (`.github/workflows/wasm-profile-matrix.yml:60`).

`--cell` accepts `P1:S0`, `P1:S1`, `P1:S1R`, `P2:S0`, `P2:S1`, `P2:S1R`, `P3:S0`, `P3:S1` and `P3:S1R` (`scripts/build-wasm.sh:419`). L0 for `light` is `P1:S0 P1:S1 P2:S0 P2:S1 P3:S0 P3:S1` (`.github/workflows/wasm-profile-matrix.yml:66`). `physics2d` and `physics3d` add `P2:S1R` and `P3:S1R` (`.github/workflows/wasm-profile-matrix.yml:68`).

Runs are interleaved: `for r in 1 2 3` encloses the cell loop (`.github/workflows/wasm-profile-matrix.yml:88`, `.github/workflows/wasm-profile-matrix.yml:168`). Before the bench the job compares the saved `gwen_core.js` with `cmp -s` (`.github/workflows/wasm-profile-matrix.yml:92`) and logs the sha256 of the swapped `gwen_core_bg.wasm` (`.github/workflows/wasm-profile-matrix.yml:97`). Each `vitest bench` call passes `--project prod` (`.github/workflows/wasm-profile-matrix.yml:102`).

The cell metric is the sum of the medians of the included rows (`scripts/wasm-profile-table.mjs:5`, `scripts/wasm-profile-table.mjs:257`). A row is one file, one group and one bench name (`scripts/wasm-profile-table.mjs:136`). Rows whose file, group or name contains `Flat JS Float32Array` are excluded (`scripts/wasm-profile-table.mjs:35`, `scripts/wasm-profile-table.mjs:134`). That label is the pure JS path (`packages/core/bench/shared-memory.bench.ts:154`, `packages/core/bench/shared-memory.bench.ts:175`).

Each variant job (`.github/workflows/wasm-profile-matrix.yml:18`) builds L1 for the winning profile at S0 and at S1 (`.github/workflows/wasm-profile-matrix.yml:125`). That is six L1 cells. Each one runs `cargo build -v --lib` into its own log (`.github/workflows/wasm-profile-matrix.yml:149`). `[profile.release]` sets `lto = true` (`Cargo.toml:15`). That setting is inert while `crate-type` is `cdylib` and `rlib` (`Cargo.toml:31`, `crates/gwen-core/Cargo.toml:9`). The L1 step rewrites `crate-type` to `["cdylib"]` (`.github/workflows/wasm-profile-matrix.yml:132`). An L1 row is void unless the log matches `-C lto` or `-C lto=fat` (`scripts/wasm-profile-table.mjs:38`, `scripts/wasm-profile-table.mjs:74`). Light uses `--no-default-features` (`crates/gwen-core/Cargo.toml:72`, `.github/workflows/wasm-profile-matrix.yml:149`). A non-empty feature list replaces that with `--features` (`scripts/build-wasm.sh:322`). S1 adds `-C target-feature=+simd128` (`scripts/build-wasm.sh:193`). S1R is the only simd feature (`scripts/build-wasm.sh:351`). L1 does not build S1R (`.github/workflows/wasm-profile-matrix.yml:125`).

The table shows median ns/op, p99 ns, spread %, raw, gzip and brotli (`scripts/wasm-profile-table.mjs:396`). ns/op is the vitest median in milliseconds times 1e6 (`scripts/wasm-profile-table.mjs:12`, `scripts/wasm-profile-table.mjs:169`). Byte counts come from `measureBuffer` (`scripts/check-wasm-size.mjs:55`, `scripts/wasm-profile-table.mjs:239`). Report mode exits 0 (`scripts/wasm-profile-table.mjs:6`). A missing cell is a `missing` row and `winner: incomplete` (`scripts/wasm-profile-table.mjs:405`, `scripts/wasm-profile-table.mjs:441`). `--winner` exits 1 when a needed L0 row, its wasm file, or a finite median is missing (`scripts/wasm-profile-table.mjs:7`, `scripts/wasm-profile-table.mjs:445`). Malformed JSON exits 1 (`scripts/wasm-profile-table.mjs:8`, `scripts/wasm-profile-table.mjs:189`). The table step and the upload use `if: always()` (`.github/workflows/wasm-profile-matrix.yml:193`, `.github/workflows/wasm-profile-matrix.yml:198`).

P3 replaces P1 when bench ≤ 0.90× (`scripts/wasm-profile-table.mjs:20`) and brotli ≤ 1.15× (`scripts/wasm-profile-table.mjs:21`) inside `replaces` (`scripts/wasm-profile-table.mjs:85`, `scripts/wasm-profile-table.mjs:286`). P2 replaces P3 only (`scripts/wasm-profile-table.mjs:287`), when bench ≤ 0.95× (`scripts/wasm-profile-table.mjs:24`) and brotli ≤ 1.10× (`scripts/wasm-profile-table.mjs:25`). S1 stays when bench ≤ 0.90× (`scripts/wasm-profile-table.mjs:22`) and brotli ≤ 1.03× (`scripts/wasm-profile-table.mjs:23`). S1R stays when bench ≤ 0.95× (`scripts/wasm-profile-table.mjs:26`) and brotli ≤ 1.05× (`scripts/wasm-profile-table.mjs:27`), and never for `light` (`scripts/wasm-profile-table.mjs:292`). An equal median keeps the smaller brotli (`scripts/wasm-profile-table.mjs:86`). Spread above 5% is the flag `re-run` (`scripts/wasm-profile-table.mjs:66`).

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
3. Builds the Node build-tools binary inside `./scripts/build-wasm.sh`, which checks wasm-pack against `wasm-size.json`. CI does not run `pnpm build:wasm:tools`. `scripts/build-wasm-tools.sh` checks wasm-pack against `wasm-size.json` too.
4. Uploads the WASM artifacts for the publish workflow
5. Publishes npm packages with embedded WASM. `toolchain.json` is not part of the `@gwenjs/core` package.

This ensures end users never need to build WASM locally.
