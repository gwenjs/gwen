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
│   ├── main.ts              # Entry point: engine setup
│   ├── components/          # defineComponent() definitions
│   │   └── Position.ts
│   ├── systems/             # defineSystem() implementations
│   │   └── Movement.ts
│   ├── scenes/              # defineScene() definitions
│   │   └── GameScene.ts
│   └── prefabs/             # definePrefab() factories
│       └── Player.ts
├── vite.config.ts           # @gwenjs/vite plugins
├── gwen.config.ts           # Engine config
├── tsconfig.json
└── package.json
```

## Your First Component

A component is a piece of data that entities can have. Let's define a `Position` component:

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('position', () => ({
  x: 0,
  y: 0,
}))
```

That's it. `defineComponent` returns a schema that defines what data travels with this component. GWEN will store position data efficiently in WASM linear memory.

## Your First System

Systems are where the magic happens. They iterate over entities with specific components and update them each frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position } from '../components/Position'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position] })

  onUpdate(() => {
    // Each frame, move every entity with a Position component
    query.each(({ entity, c }) => {
      const pos = c[Position]
      pos.x += 0.5  // Move right
      pos.y += 0.1  // Move down slightly
    })
  })
})
```

The `useQuery` hook finds all entities with the `Position` component. `onUpdate` runs every frame. Inside, we iterate with `.each()` and update positions. WASM takes care of writing the changes back.

## Your First Scene

Scenes are where you place and compose entities. They're functions that set up a playable level.

**src/scenes/GameScene.ts**
```typescript
import { defineScene, createEntity } from '@gwenjs/core'
import { Position } from '../components/Position'

export const GameScene = defineScene('game', ({ entities }) => {
  // Create an actor (an entity with renderable components)
  const player = createEntity()
  entities.add(player)
  
  // Give it a Position
  entities.setComponent(player, Position, { x: 100, y: 100 })
})
```

## Wire It All Together

**src/main.ts**
```typescript
import { createEngine, defineConfig } from '@gwenjs/app'
import { Position } from './components/Position'
import { MovementSystem } from './systems/Movement'
import { GameScene } from './scenes/GameScene'

const engine = createEngine(
  defineConfig({
    modules: [Position],
    systems: [MovementSystem],
    scenes: [GameScene],
    initialScene: 'game',
  })
)

engine.run()
```

## Run It

```sh
pnpm dev
```

Open your browser. You should see your game running—entities are being created, the movement system updates their positions every frame, and you're seeing the result rendered.

## Next Steps

- **[Installation](/guide/installation)** — Add GWEN to an existing project.
- **[Project Structure](/guide/project-structure)** — Understand the anatomy of a GWEN project.
- **[Components](/essentials/components)** — Learn how to design your component schemas.
- **[Systems](/essentials/systems)** — Master system queries and lifecycle hooks.
- **[Scenes](/essentials/scenes)** — Compose complex levels and gameplay.
