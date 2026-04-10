---
title: Project Structure
description: Overview of a typical GWEN project layout.
---

# Project Structure

Understanding how a GWEN project is organized helps you write code that scales and stays maintainable. Here's a typical structure and what each directory does.

## Typical Layout

```
my-game/
├── gwen.config.ts           # Framework + engine configuration
└── src/
    ├── components/          # defineComponent() — ECS data definitions
    │   └── Position.ts
    ├── systems/             # defineSystem() — game logic
    │   └── Movement.ts
    ├── scenes/              # defineScene() — scene definitions
    │   └── GameScene.ts
    ├── actors/              # defineActor() — instance-based game objects
    │   └── Player.ts
    ├── prefabs/             # definePrefab() — entity templates
    │   └── Bullet.ts
    ├── router.ts            # defineSceneRouter() — scene navigation FSM
    ├── plugins/             # definePlugin() — custom plugins (optional)
    ├── assets/              # images, audio, fonts...
    └── utils/               # shared helpers
```

::: info Auto-generated files
`index.html` and `main.ts` are generated automatically by the GWEN framework. You never create or edit them directly.
:::

## Directory Purposes

### `gwen.config.ts` — Configuration

Declares modules and engine options at build-time:

```typescript
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
  },
})
```

### `src/components/` — Component Definitions

Each file defines one or more component schemas. Components are data containers attached to entities.

**src/components/Position.ts**
```typescript
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})
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
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { Position, Velocity } from '../components'

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of query) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

### `src/scenes/` — Scene Definitions

Scenes are functions that set up gameplay and register systems:

**src/scenes/GameScene.ts**
```typescript
import { defineScene } from '@gwenjs/core/scene'
import { MovementSystem, CollisionSystem, RenderSystem } from '../systems'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, CollisionSystem, RenderSystem],
})
```

### `src/actors/` — Named Entities

Actors are named, singleton-like entities defined with `defineActor()`. Use them for things that exist once per scene — the player, a boss, a camera. Each actor has its own lifecycle (`onStart`, `onDestroy`) and can use physics composables.

**src/actors/Player.ts**
```typescript
import { defineActor, onStart, onDestroy } from '@gwenjs/core/actor'
import { useDynamicBody, useBoxCollider } from '@gwenjs/physics2d'
import { Position, Health } from '../components'

const PlayerPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health,   defaults: { hp: 100 } },
])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  useDynamicBody({ gravityScale: 1 })
  useBoxCollider({ width: 1, height: 2 })

  onStart(() => {
    Position.x[entityId] = 100
    Position.y[entityId] = 100
  })
})
```

### `src/prefabs/` — Reusable Entity Templates

Prefabs are defined with `definePrefab()` for entities you spawn in bulk — bullets, coins, enemies. They declare which components each instance gets and their default values.

**src/prefabs/Bullet.ts**
```typescript
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, DamageTag } from '../components'

export const BulletPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { x: 0, y: 10 } },
  { def: DamageTag, defaults: {} },
])
```

### `src/plugins/` — Custom Plugins

Plugins extend GWEN with new systems, components, or lifecycle hooks. Use them for reusable features like input handling, audio, or analytics.

**src/plugins/InputPlugin.ts**
```typescript
import { definePlugin } from '@gwenjs/kit/plugin'
import { InputSystem } from '../systems/Input'

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  setup(engine) {
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
