---
title: Architecture
description: How GWEN splits responsibilities between Rust/WASM and TypeScript, and how the ECS layer brings them together.
---

# Architecture

GWEN's architecture is built on a fundamental split: **TypeScript for game logic, Rust/WASM for performance**. This guide walks you through the two layers, how they communicate, and how the Entity-Component-System (ECS) model ties everything together.

## The Two Layers

### Rust/WASM Core

The heart of GWEN is a pre-compiled WebAssembly module (`gwen_core.wasm`) written in Rust. This layer handles everything that must be fast:

- **ECS Engine** — Stores entities, components, and manages queries efficiently
- **Component columns** — Each numeric field of a chunk is its own typed array in WASM linear memory
- **Physics** — Physics simulation (via Rapier) runs in WASM
- **Math Primitives** — Vector, matrix, and quaternion math for the hot path

You never write Rust. The WASM module ships pre-compiled in npm packages (`@gwenjs/core`, `@gwenjs/physics2d`, etc.).

### TypeScript Layer

All game logic you write lives in TypeScript. This includes:

- **Systems** — Functions that read and write component data each frame
- **Scene Graph** — Actors, prefabs, and scene management
- **Plugin Lifecycle** — Setup, frame hooks, teardown
- **Vite Tooling** — Development server, HMR, bundling

The TypeScript layer calls into WASM to query entities, read component data, and apply physics updates.

## The WASM Bridge

Communication between TypeScript and WASM happens through function calls. Chunk columns are typed-array views over the module's `WebAssembly.Memory`. v1 does not share that memory across threads. `engine.memory` is always present and is the same object as `engine.inject("memory")`.

`WasmModuleOptions.transformRegion` names a `memory.regions` entry. That region receives the per-frame transform copy. When the option is absent, there is no copy, and `transform_buffer_ptr()` returns 0.

Cross-origin isolation is optional. Set it through Vite `server.headers` and `preview.headers` when you need it.

```ts check
import type { WasmModuleOptions } from "@gwenjs/core";

const options: WasmModuleOptions = {
  name: "demo",
  url: "./demo.wasm",
  transformRegion: "transforms",
};
void options;
```

```
┌──────────────────────────────────────┐
│ TypeScript Code                      │
│ - defineSystem()                     │
│ - useQuery()                         │
│ - chunk.get(Position).x[row] = 10    │
└──────────────┬───────────────────────┘
               │ column views
┌──────────────┴───────────────────────┐
│ engine.memory / WebAssembly.Memory   │
│ ┌────────────────────────────────┐   │
│ │ one chunk                      │   │
│ │ ┌──────────────────────────┐   │   │
│ │ │ pos.x: Float32Array      │   │   │
│ │ │ pos.y: Float32Array      │   │   │
│ │ └──────────────────────────┘   │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

A column write changes the WASM row. `engine.getComponent` reads that row back as a snapshot. After WASM memory grows, old typed-array views are detached. Call `chunk.get` again.

```ts run
import assert from "node:assert/strict";

assert.equal(engine.memory.epoch, 0);
assert.equal(engine.memory, engine.inject("memory"));
```

## Build id and fingerprint

Each core binary carries a `gwen.fingerprint` custom section. The section text is `gwen-core;variant=<v>;abi=<N>;profile=<release|dev>`. The export `gwen_abi_fingerprint()` is the FNV-1a 32-bit hash of that string. Each browser variant (`light`, `physics2d`, `physics3d`) also carries a `gwen.build` section: the sha256 hex of the bytes before that section was appended. The factory reads both sections into `CONTRACT`. A binary must ship with the factory of the same build.

## ECS Overview

GWEN uses the **Entity-Component-System** (ECS) pattern to organize game data and logic:

### Entities

An **entity** is a `bigint` ID that groups related components together. There's no class hierarchy — an entity is just a number.

### Components

A **component** is a typed data structure holding pure data — no logic, no methods.

```ts
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: { x: Types.f32, y: Types.f32 },
})

export const Health = defineComponent({
  name: 'Health',
  schema: { current: Types.i32, max: Types.i32 },
})
```

Multiple components attach to the same entity to describe it. A player might have `Position`, `Health`, `Velocity`, and `PlayerTag`.

### Systems

A **system** is a function that runs each frame over all entities matching a query. Systems read and write component data.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { x: Types.f32, y: Types.f32 },
});

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      const vel = chunk.get(Velocity);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (vel.x[row] ?? 0) * dt;
        pos.y[row] = (pos.y[row] ?? 0) + (vel.y[row] ?? 0) * dt;
      }
    }
  });
});
```

`useQuery` returns a `Query`. `chunk.get(Def)` is the live columns. `query.each()` yields one accessor per entity, and `entity.get(Def)` returns a snapshot.

### Why ECS?

No inheritance, no polymorphism headaches. Just data + logic. This makes GWEN:

- **Columnar** — One typed array per numeric field inside a chunk
- **Flexible** — Compose any combination of components; add new systems anytime
- **Testable** — Systems don't depend on a class hierarchy; they're just functions

## Frame Loop

Each frame, GWEN runs callbacks in this order:

```
engine:before-update  →  onBeforeUpdate(dt)   — input sampling, pre-simulation
engine:update         →  onUpdate(dt)          — main game logic, AI, movement
engine:after-update   →  onAfterUpdate(dt)     — state sync, scoring
engine:render         →  onRender()            — draw calls
```

Systems and actors register callbacks in the appropriate phase via composables (`onUpdate`, `onRender`, etc.).

## Next Steps

- **[The Engine](/essentials/engine)** — Configure your game with `gwen.config.ts`.
- **[Components](/essentials/components)** — Define the data structures your game will use.
- **[Systems](/essentials/systems)** — Write systems that bring components to life.
- **[Project Structure](/guide/project-structure)** — See how a real GWEN project organizes systems and components.
