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
- **Component Arrays** — Component data lives in WASM linear memory in Structure-of-Arrays (SoA) layout for cache efficiency
- **Physics** — Physics simulation (via Rapier) runs in WASM
- **Math Primitives** — Vector, matrix, and quaternion math for the hot path

You never write Rust. The WASM module ships pre-compiled in npm packages (`@gwenjs/core`, `@gwenjs/physics2d`, etc.).

### TypeScript Layer

All game logic you write lives in TypeScript. This includes:

- **Systems** — Functions that read and write component data each frame
- **Scene Graph** — Actors, prefabs, and scene management
- **Plugin Lifecycle** — `mount()`, `onStart()`, `onUpdate()`, `onDestroy()`, `unmount()`
- **Vite Tooling** — Development server, HMR, bundling

The TypeScript layer calls into WASM to query entities, read component data, and apply physics updates.

## The WASM Bridge

Communication between TypeScript and WASM happens through **shared memory and function calls**. There is no serialization; instead, WASM linear memory is exposed to TypeScript via `SharedArrayBuffer` and `TypedArray` views.

```
┌──────────────────────────────────────┐
│ TypeScript Code                      │
│ - defineSystem()                     │
│ - useQuery()                         │
│ - Position.x[entityId] = 10          │
└──────────────┬───────────────────────┘
               │ Direct memory access (no copying)
┌──────────────┴───────────────────────┐
│ SharedArrayBuffer                    │
│ ┌────────────────────────────────┐   │
│ │ WASM Linear Memory             │   │
│ │ ┌──────────────────────────┐   │   │
│ │ │ Position.x: [1, 2, 3]    │   │   │
│ │ │ Position.y: [4, 5, 6]    │   │   │
│ │ └──────────────────────────┘   │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

When you write `Position.x[entityId] = 10` in a system, you're writing directly to WASM memory with zero overhead. No marshaling, no allocations, no garbage collection.

## ECS Overview

GWEN uses the **Entity-Component-System** (ECS) pattern to organize game data and logic:

### Entities

An **entity** is an integer ID that groups related components together.

```ts
// Internally, an entity is just a number
const playerId = 42
```

There's no inheritance hierarchy, no class hierarchy. An entity is just a container.

### Components

A **component** is a typed data structure holding pure data—no logic, no methods.

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

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

The query `[Position, Velocity]` returns all entity IDs that have both components. The system updates their positions based on velocity.

### Why ECS?

No inheritance, no polymorphism headaches. Just data + logic. Systems are pure functions that read and write data. This makes GWEN:

- **Fast** — Cache-efficient memory layout (SoA) and data-parallel execution
- **Flexible** — Compose any combination of components; add new systems anytime
- **Testable** — Systems don't depend on a class hierarchy; they're just functions

## Plugin Lifecycle

GWEN engines load plugins, which mount and unmount during the game's lifecycle:

```
Boot
  ↓
engine.start()
  ↓
mount() on each plugin
  ↓
Load initial scene
  ↓
onStart() on each actor → onStart() on each system
  ↓
Game Loop:
  - onUpdate(dt) on each system
  - Render (via your renderer)
  ↓
onDestroy() on each actor → onDestroy() on each system
  ↓
Unload scene
  ↓
unmount() on each plugin
  ↓
Shutdown
```

Systems register callbacks during their setup phase (`defineSystem(() => { ... })`). These callbacks fire during the appropriate lifecycle stages.

## Data Flow: From TypeScript to WASM and Back

Here's how a typical frame executes:

```
1. TypeScript code spawns a new entity
   → Call WASM function: spawn(components...)
   → WASM allocates entity ID, initializes component data

2. Frame starts
   → TypeScript calls useQuery([Position, Velocity])
   → Query returns array of matching entity IDs
   → TypeScript code iterates and reads/writes component data
   → Data lives in WASM memory; TypeScript accesses via TypedArray view

3. Physics tick
   → WASM physics engine (Rapier) runs
   → Updates Rigidbody and Transform components

4. Render
   → TypeScript reads Position, Rotation, etc.
   → Passes to renderer (Babylon.js, Three.js, Canvas 2D, etc.)

5. End of frame
   → Physics and graphics state sync
   → Next frame begins
```

The key insight: **no data copying**. TypeScript directly addresses WASM memory. Your game loop is memory-efficient.

## Next Steps

- **[The Engine](/essentials/engine)** — Create and configure your first GWEN engine.
- **[Components](/essentials/components)** — Define the data structures your game will use.
- **[Systems](/essentials/systems)** — Write systems that bring components to life.
- **[Project Structure](/guide/project-structure)** — See how a real GWEN project organizes systems and components.
