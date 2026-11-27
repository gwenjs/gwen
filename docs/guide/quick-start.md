---
title: Quick Start
description: Get a GWEN project running in under five minutes.
---

# Quick Start

The fastest way to start a GWEN project is with the create scaffold. In seconds, you'll have a working game template with all the tooling set up.

## Prerequisites

- **Node.js 18+** and **pnpm 8+**
- No Rust required—WASM ships pre-compiled in npm packages

::: tip
If you don't have pnpm, install it globally: `npm install -g pnpm`
:::

## Create a Project

```sh
pnpm create @gwenjs/create my-game
cd my-game
pnpm install:all
pnpm dev
```

Your browser should open to `http://localhost:5173` with your first game running.

## Project Layout

The scaffold creates a structured game project:

```
my-game/
├── gwen.config.ts           # Build config (modules, engine options)
└── src/
    ├── components/          # defineComponent() definitions
    │   └── Position.ts
    ├── systems/             # defineSystem() implementations
    │   └── Movement.ts
    ├── scenes/              # defineScene() definitions
    │   └── GameScene.ts
    ├── actors/              # defineActor() — instance-based entities
    │   └── Player.ts
    ├── prefabs/             # definePrefab() — reusable templates
    │   └── Bullet.ts
    └── router.ts            # defineSceneRouter() — scene navigation FSM
```

## Build Configuration — `gwen.config.ts`

Define engine options at build time:

<<< @/../examples/hello-light/gwen.config.ts{ts}

## Your First Component

A component is a piece of data. Let's define a `Position` component:

**src/components/Position.ts**

<<< @/../examples/hello-light/src/components/Position.ts{ts}

## Your First System

Systems iterate over entities and update them each frame.

**src/systems/Movement.ts**

<<< @/../examples/hello-light/src/systems/Movement.ts{ts}

## Your First Scene

**src/scenes/GameScene.ts**

<<< @/../examples/hello-light/src/scenes/GameScene.ts{ts}

## Scene Router

Define navigation between scenes:

**src/router.ts**

<<< @/../examples/hello-light/src/router.ts{ts}

## Run It

```sh
pnpm dev
```

Open your browser. You should see your game running—the Movement system updates positions every frame, and you're seeing the result rendered.

## Next Steps

- **[Installation](/guide/installation)** — Add GWEN to an existing project.
- **[Project Structure](/guide/project-structure)** — Understand the anatomy of a GWEN project.
- **[The Engine](/essentials/engine)** — Learn engine config and bootstrap.
- **[Components](/essentials/components)** — Design component schemas.
- **[Systems](/essentials/systems)** — Master system queries and lifecycle hooks.
