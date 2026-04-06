---
title: Project Structure
description: Overview of a typical GWEN project layout.
---

# Project Structure

Understanding how a GWEN project is organized helps you write code that scales and stays maintainable. Here's a typical structure and what each directory does.

## Typical Layout

```
my-game/
├── src/
│   ├── main.ts                    # Engine entry point
│   ├── components/                # Component definitions
│   │   ├── Position.ts
│   │   ├── Velocity.ts
│   │   ├── Health.ts
│   │   └── index.ts               # Re-export all components
│   ├── systems/                   # System implementations
│   │   ├── Movement.ts
│   │   ├── Collision.ts
│   │   ├── Rendering.ts
│   │   └── index.ts               # Re-export all systems
│   ├── scenes/                    # Scene definitions
│   │   ├── MainMenu.ts
│   │   ├── GameScene.ts
│   │   ├── GameOver.ts
│   │   └── index.ts
│   ├── actors/                    # Named entity definitions (defineActor)
│   │   ├── Player.ts
│   │   ├── Enemy.ts
│   │   └── index.ts
│   ├── prefabs/                   # Reusable entity templates (definePrefab)
│   │   ├── Bullet.ts
│   │   ├── Coin.ts
│   │   └── index.ts
│   ├── plugins/                   # Custom plugin factories
│   │   ├── PhysicsPlugin.ts
│   │   ├── InputPlugin.ts
│   │   └── index.ts
│   ├── assets/                    # Static assets
│   │   ├── sprites/
│   │   ├── sounds/
│   │   └── levels/
│   └── utils/                     # Helpers and utilities
│       ├── math.ts
│       └── input.ts
├── gwen.config.ts                 # GWEN engine configuration
├── tsconfig.json                  # TypeScript settings
├── package.json
└── pnpm-lock.yaml
```

## Directory Purposes

### `src/main.ts` — Engine Entry Point

Initializes the GWEN engine, wires up all modules, systems, and scenes:

```typescript
import { createEngine, defineConfig } from '@gwenjs/app'
import * as components from './components'
import * as systems from './systems'
import * as scenes from './scenes'

const engine = createEngine(
  defineConfig({
    modules: Object.values(components),
    systems: Object.values(systems),
    scenes: Object.values(scenes),
    initialScene: 'game',
  })
)

engine.run()
```

### `src/components/` — Component Definitions

Each file defines one or more component schemas. Components are data containers attached to entities.

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('position', () => ({
  x: 0,
  y: 0,
}))
```

Use `src/components/index.ts` to re-export everything:

```typescript
export * from './Position'
export * from './Velocity'
export * from './Health'
```

### `src/systems/` — System Implementations

Systems are the logic layer. They query entities and modify their components each frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position, Velocity } from '../components'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position, Velocity] })

  onUpdate(() => {
    query.each(({ c }) => {
      const pos = c[Position]
      const vel = c[Velocity]
      pos.x += vel.vx
      pos.y += vel.vy
    })
  })
})
```

### `src/scenes/` — Scene Definitions

Scenes are functions that spawn entities and set up gameplay. Think of them as "levels" or "screens."

**src/scenes/GameScene.ts**
```typescript
import { defineScene, createEntity } from '@gwenjs/core'
import { Player } from '../prefabs'
import { EnemyPrefab } from '../prefabs'

export const GameScene = defineScene('game', ({ entities }) => {
  // Spawn the player
  entities.add(Player.create())

  // Spawn enemies
  for (let i = 0; i < 5; i++) {
    entities.add(EnemyPrefab.create({ x: i * 50, y: 10 }))
  }
})
```

### `src/actors/` — Named Entities

Actors are named, singleton-like entities defined with `defineActor()`. Use them for things that exist once per scene — the player, a boss, a camera. Each actor has its own lifecycle (`onStart`, `onDestroy`) and can use physics composables.

**src/actors/Player.ts**
```typescript
import { defineActor, onStart, onDestroy } from '@gwenjs/core'
import { useDynamicBody, useBoxCollider } from '@gwenjs/physics2d'
import { Position, Health } from '../components'

export const PlayerActor = defineActor('Player', () => {
  useDynamicBody({ gravityScale: 1 })
  useBoxCollider({ width: 1, height: 2 })

  onStart(() => {
    Position.x[0] = 100
    Position.y[0] = 100
  })
})
```

### `src/prefabs/` — Reusable Entity Templates

Prefabs are defined with `definePrefab()` for entities you spawn in bulk — bullets, coins, enemies. They declare which components each instance gets and their default values.

**src/prefabs/Bullet.ts**
```typescript
import { definePrefab } from '@gwenjs/core'
import { Position, Velocity, DamageTag } from '../components'

export const BulletPrefab = definePrefab({
  name: 'Bullet',
  components: [Position, Velocity, DamageTag],
  defaults: {
    [Position.name]: { x: 0, y: 0 },
    [Velocity.name]: { x: 0, y: 10 },
  },
})
```

### `src/plugins/` — Custom Plugins

Plugins extend GWEN with new systems, components, or lifecycle hooks. Use them for reusable features like input handling, audio, or analytics.

**src/plugins/InputPlugin.ts**
```typescript
import { definePlugin } from '@gwenjs/kit'
import { InputSystem } from '../systems/Input'

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  systems: [InputSystem],
  install: (engine) => {
    console.log('Input plugin installed')
  },
}))
```

### `src/assets/` — Static Files

Keep sprites, sounds, level data, and other assets organized here. Vite will handle bundling and optimization.

```
assets/
├── sprites/
│   ├── player.png
│   ├── enemies/
│   └── ui/
├── sounds/
│   ├── jump.wav
│   └── music/
└── levels/
    ├── level1.json
    └── level2.json
```

### `src/utils/` — Shared Utilities

Common helpers that don't fit elsewhere: math functions, input helpers, state managers, etc.

**src/utils/math.ts**
```typescript
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
```

## Configuration Files

### `gwen.config.ts` — Engine Configuration

The main configuration file for your GWEN project. Declares plugins, scenes, WASM variant, and debug options:

```typescript
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  wasmVariant: 'release', // or 'debug'
  enableDebugMode: true,
})
```

### `tsconfig.json` — TypeScript Configuration

Ensures strict type checking and proper module resolution:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Scaling Patterns

As your game grows, consider these organizational patterns:

**By Feature** — Group related components, systems, and scenes together:

```
src/
├── features/
│   ├── player/
│   │   ├── components/
│   │   ├── systems/
│   │   └── prefabs/
│   ├── enemies/
│   │   ├── components/
│   │   ├── systems/
│   │   └── prefabs/
│   └── ui/
│       ├── systems/
│       └── scenes/
```

**By Responsibility** — Keep systems, components, and prefabs in their own top-level directories (shown above). This works well for smaller games.

**By Domain** — Separate gameplay, graphics, physics, audio, and networking into their own domains with plugins.

## Best Practices

1. **Use index files** — Re-export from `components/index.ts`, `systems/index.ts`, etc., for clean imports.
2. **One component per file** — Easier to find and refactor.
3. **Name systems after what they do** — `MovementSystem`, `CollisionSystem`, not `UpdateLogic`.
4. **Prefabs for complex entities** — If an entity uses 3+ components, create a prefab for it.
5. **Plugins for reusable features** — Input handling, UI, animations—wrap in plugins so other projects can reuse them.

## Next Steps

- **[Components](/essentials/components)** — Learn how to design component schemas.
- **[Systems](/essentials/systems)** — Master system queries and hooks.
- **[Scenes](/essentials/scenes)** — Compose and manage scenes.
- **[Prefabs](/essentials/prefabs)** — Create reusable entity templates.
