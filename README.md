# GWEN

A composable TypeScript-first web game engine with a Rust/WebAssembly core.

Write game logic in TypeScript. Run ECS, physics, and math in pre-compiled WebAssembly. No Rust required.

---

## Why GWEN?

Raw WebGL is too low-level. Full game engines are too opinionated. Rendering libraries have no ECS or scene management.

GWEN is the missing layer: a composable, TypeScript-native foundation for web games that doesn't dictate your renderer or physics backend.

- **TypeScript DX** — define components, systems, actors, and scenes with full type inference
- **WASM performance** — ECS engine and physics run in Rust/WASM, not in JS
- **Composable by design** — plugins and modules extend the engine without touching core
- **Zero Rust setup** — WASM ships pre-compiled in npm packages

---

## Packages

| Package | Description |
|---|---|
| `@gwenjs/core` | ECS engine, components, systems, actors, scenes, scene router |
| `@gwenjs/app` | Engine bootstrap and `defineConfig()` |
| `@gwenjs/kit` | Plugin and module authoring API |
| `@gwenjs/math` | Vectors, quaternions, colors, springs, scalar helpers |
| `@gwenjs/physics2d` | 2D rigid-body physics (Rapier via WASM) |
| `@gwenjs/physics3d` | 3D rigid-body physics (Rapier via WASM) |
| `@gwenjs/physics3d-fracture` | Destructible mesh support for physics3d |
| `@gwenjs/schema` | Component schema primitives and type utilities |
| `@gwenjs/vite` | Vite plugin — WASM bundling, system name injection, optimizer |

---

## Quick Start

```sh
pnpm create @gwenjs/create my-game
cd my-game
pnpm install:all
pnpm dev
```

No Rust toolchain needed — WASM ships pre-compiled.

---

## How It Works

```
┌─ Your Game Code (TypeScript) ─────────────────────┐
│  components, systems, actors, scenes, plugins      │
└────────────────────────┬───────────────────────────┘
                         │ imports @gwenjs/*
         ┌───────────────┴──────────────┐
         │  @gwenjs/core                │
         │  @gwenjs/physics2d / 3d      │
         │  @gwenjs/math                │
         └───────────────┬──────────────┘
                         │ WASM bridge
┌────────────────────────┴───────────────────────────┐
│  gwen_core.wasm (Rust)                             │
│  — ECS engine      — Linear memory (SoA layout)   │
│  — Rapier physics  — Math primitives               │
└────────────────────────────────────────────────────┘
```

Component data lives in **Structure-of-Arrays** layout inside WASM linear memory. Systems access it directly with entity IDs — no boxing, no garbage collection pressure.

---

## Example

```ts
import { defineComponent, Types } from '@gwenjs/core'
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { defineScene } from '@gwenjs/core/scene'

// 1 — Components
const Position = defineComponent({ name: 'Position', schema: { x: Types.f32, y: Types.f32 } })
const Velocity = defineComponent({ name: 'Velocity', schema: { vx: Types.f32, vy: Types.f32 } })

// 2 — System
export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.vx[id] * dt
      Position.y[id] += Velocity.vy[id] * dt
    }
  })
})

// 3 — Scene
export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem],
})
```

---

## Development

### Prerequisites

- Node.js 18+, pnpm 8+
- Rust + `wasm-pack` (only needed to rebuild WASM — not required for TypeScript-only changes)

### Setup

```sh
pnpm install
```

To also build WASM from source:

```sh
pnpm install:all   # installs deps + builds WASM
```

### Commands

```sh
pnpm dev           # start all packages in watch mode
pnpm build         # build WASM + all TS packages
pnpm test          # run Rust + TypeScript tests
pnpm test:ts       # TypeScript tests only
pnpm typecheck     # type-check all packages
pnpm lint          # oxlint
pnpm lint:fix      # auto-fix lint issues
pnpm format        # oxfmt
pnpm docs:dev      # start documentation site
```

### Repository Structure

```
packages/
├── core/            # @gwenjs/core
├── app/             # @gwenjs/app
├── kit/             # @gwenjs/kit
├── math/            # @gwenjs/math
├── schema/          # @gwenjs/schema
├── physics2d/       # @gwenjs/physics2d
├── physics3d/       # @gwenjs/physics3d
├── physics3d-fracture/
└── vite/            # @gwenjs/vite
crate/               # Rust source (ECS + physics WASM)
docs/                # VitePress documentation site
```

---

## Documentation

Full documentation at [gwenjs.dev](https://gwenjs.dev) — or run it locally:

```sh
pnpm docs:dev
```

---

## License

[MPL-2.0](./LICENSE)
