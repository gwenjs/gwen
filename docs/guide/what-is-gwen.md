---
title: What is GWEN?
description: GWEN is a TypeScript-first web game framework with a Rust/WASM core.
---

# What is GWEN?

GWEN is a composable web game engine that combines TypeScript's developer experience with Rust/WebAssembly's performance. Write your game logic in TypeScript while CPU-intensive systems—ECS, physics, and math—run in pre-compiled WebAssembly. No Rust required; no performance compromises.

## The Core Idea

GWEN splits responsibilities between two worlds:

**Rust/WASM Layer** — The foundation where it matters. Your ECS engine, physics simulation, and math utilities run in pre-compiled WebAssembly for maximum speed. Think of this as the "engine runtime."

**TypeScript Layer** — The game layer where you spend your time. Define components, write systems, craft scenes, and build gameplay in pure TypeScript. You never write or compile Rust.

The two worlds talk through a thin bridge: your TypeScript code calls into WASM functions, WASM reads and writes data structures, and events flow back to TypeScript. It's transparent, idiomatic, and fast.

## Who Is GWEN For?

**Web game developers** who want near-native performance without leaving TypeScript. GWEN sits in the gap:

- **Raw canvas/WebGL?** Too low-level. You rewrite physics, inputs, rendering from scratch.
- **A full game engine like Godot?** Too opinionated. Can't easily add your own renderer or physics.
- **Three.js or Babylon.js?** Great for rendering, but no ECS, no physics, no scene management.

GWEN is the missing layer: a composable, TypeScript-native foundation for web games that doesn't dictate how you render or what you build.

## How It Works

Here's the architecture at a glance:

```
┌─ Your Game Code (TypeScript) ─────────────────┐
│  systems, components, scenes, plugins         │
└─────────────────────┬─────────────────────────┘
                      │ imports @gwenjs/*
        ┌─────────────┴─────────────┐
        │  @gwenjs/core             │
        │  @gwenjs/app              │
        │  @gwenjs/physics2d        │
        │  etc.                     │
        └─────────────┬─────────────┘
                      │ WASM bindings
┌─────────────────────┴──────────────────────────┐
│  gwen_core.wasm (Rust/WASM)                   │
│  - ECS engine                                  │
│  - Linear memory (component data)              │
│  - Physics (Rapier)                            │
│  - Math primitives                             │
└────────────────────────────────────────────────┘
```

**Game code** stays in TypeScript. You call functions like `engine.update()` or spawn entities. **WASM engine** executes systems on all entities, reads their data from linear memory, and returns results. **TypeScript bindings** let you define systems as TypeScript functions that WASM calls each frame.

## Next Steps

- **[Quick Start](/guide/quick-start)** — Create and run your first GWEN project in 5 minutes.
- **[Installation](/guide/installation)** — Add GWEN to an existing project.
- **[Project Structure](/guide/project-structure)** — Understand how a GWEN project is organized.
- **[Architecture Deep Dive](/essentials/architecture)** — Learn how the ECS, WASM bridge, and plugin system work together.
