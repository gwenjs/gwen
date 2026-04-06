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
├── src/
│   ├── main.ts              # Entry point: engine bootstrap
│   ├── gwen.config.ts       # Build config (modules, engine options)
│   ├── components/          # defineComponent() definitions
│   │   └── Position.ts
│   ├── systems/             # defineSystem() implementations
│   │   └── Movement.ts
│   ├── scenes/              # defineScene() definitions
│   │   └── GameScene.ts
│   ├── actors/              # defineActor() — instance-based entities
│   │   └── Player.ts
│   ├── prefabs/             # definePrefab() — reusable templates
│   │   └── Bullet.ts
│   ├── router.ts            # defineSceneRouter() — scene FSM
│   └── index.html
├── tsconfig.json
└── package.json
```

## Build Configuration — `gwen.config.ts`

Define modules and engine options at build time:

```typescript
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
  },
})
```

## Your First Component

A component is a piece of data. Let's define a `Position` component:

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('Position', () => ({
  x: 0,
  y: 0,
}))
```

## Your First System

Systems iterate over entities and update them each frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position } from '../components/Position'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position] })

  onUpdate(() => {
    // Each frame, move every entity with a Position
    query.each(({ c }) => {
      const pos = c[Position]
      pos.x += 0.5  // Move right
      pos.y += 0.1  // Move down slightly
    })
  })
})
```

## Your First Scene

**src/scenes/GameScene.ts**
```typescript
import { defineScene } from '@gwenjs/core'
import { MovementSystem } from '../systems/Movement'

export const GameScene = defineScene({
  name: 'Game',
  systems: [MovementSystem],
})
```

## Scene Router

Define navigation between scenes:

**src/router.ts**
```typescript
import { defineSceneRouter } from '@gwenjs/core'
import { GameScene } from './scenes/GameScene'

export const AppRouter = defineSceneRouter({
  initial: 'game',
  routes: {
    game: { scene: GameScene, on: {} },
  },
})
```

## Bootstrap — `main.ts`

Create the engine, mount plugins and router, then start:

**src/main.ts**
```typescript
import { createEngine } from '@gwenjs/core'
import { Physics2DPlugin } from '@gwenjs/physics2d'
import { AppRouter } from './router'

const engine = await createEngine({
  maxEntities: 10_000,
  variant: 'physics2d',
})

// Mount plugins and router
await engine.use(Physics2DPlugin())
await engine.use(AppRouter)

// Start the game loop
await engine.start()
```

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
