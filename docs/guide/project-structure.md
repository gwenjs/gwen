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
    ├── plugins/             # definePlugin() — local plugins
    ├── modules/             # defineGwenModule() — local modules
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
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { MovementSystem, CollisionSystem, RenderSystem } from '../systems'

export const GameScene = defineScene('game', () => {
    useSystem(MovementSystem())
    useSystem(CollisionSystem())
    useSystem(RenderSystem())
})
```

### `src/actors/` — Named Entities

Actors are named, singleton-like entities defined with `defineActor()`. Use them for things that exist once per scene — the player, a boss, a camera. Each actor has its own lifecycle (`onStart`, `onDestroy`) and can use physics composables.

**src/actors/Player.ts**
```typescript
import { defineActor, definePrefab, onStart, onDestroy, useEntityId } from '@gwenjs/core/actor'
import { useDynamicBody, useBoxCollider } from '@gwenjs/physics2d'
import { Position, Health } from '../components'

const PlayerPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health,   defaults: { hp: 100 } },
])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const entityId = useEntityId()
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

### `src/plugins/` — Local Plugins

Files in this directory are **auto-discovered and registered automatically** — no `gwen.config.ts` entry needed.

Each file must export a `definePlugin` factory as its **default export**:

**src/plugins/audio.ts**
```typescript
import { definePlugin } from '@gwenjs/kit/plugin'

export default definePlugin(() => ({
  name: 'audio',
  setup(engine) {
    const manager = createAudioManager() // your own implementation
    engine.provide('audio', manager)
    engine.hooks.hook('engine:stop', () => manager.dispose())
  },
}))
```

::: info Export default, not named
The framework calls the factory with no arguments at registration time. If your plugin needs options from `gwen.config.ts`, use a local module instead (see `src/modules/` below).
:::

::: tip Flat files only
`src/plugins/audio.ts` ✅ — `src/plugins/audio/index.ts` ❌. Subdirectories are not scanned. Plugins are intentionally single-file — if a plugin grows large enough to need multiple files, wrap it in a local module (`src/modules/`) instead.
:::

### `src/modules/` — Local Modules

Files in this directory are **auto-discovered and loaded before** `config.plugins`. They work exactly like npm modules declared in `gwen.config.ts`, but live in your project — no package to publish, no config entry required.

Each file must export a `defineGwenModule` definition as its **default export**.

**Name inference** — `meta.name` is optional for local modules:

| File | Inferred name |
|---|---|
| `src/modules/score.ts` | `local:score` |
| `src/modules/score/index.ts` | `local:score` |
| explicit `meta: { name: 'my-score' }` | `my-score` |

**Receiving options from `gwen.config.ts`** — when `meta.configKey` is set, the user passes options at the matching top-level key. Augment `GwenModuleOptions` in the same file for full TypeScript auto-complete:

```typescript
// src/modules/score.ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

interface ScoreOptions {
  maxScore?: number
}

declare module '@gwenjs/app' {
  interface GwenModuleOptions {
    score?: ScoreOptions
  }
}

const ScorePlugin = definePlugin<ScoreOptions>((opts = {}) => ({
  name: 'score',
  setup(engine) {
    let score = 0
    engine.provide('score', {
      get: () => score,
      add: (n: number) => { score = Math.min(score + n, opts.maxScore ?? 999) },
      reset: () => { score = 0 },
    })
  },
}))

export default defineGwenModule<ScoreOptions>({
  meta: { configKey: 'score' },
  defaults: { maxScore: 999 },
  setup(options, gwen) {
    gwen.addPlugin(ScorePlugin(options))
  },
})
```

Users configure it with the top-level key:

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  score: { maxScore: 9999 }, // fully typed
})
```

::: tip Subdirectory support
`src/modules/score/index.ts` is supported and inferred as `local:score`. Use this to split a complex module across multiple files.
:::

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

## Load Order

At runtime, plugins and modules are applied in this order:

1. Built-in framework plugins (viewports, screen)
2. `config.plugins` — includes plugins contributed by npm modules at build time
3. `src/modules/` — local modules (alphabetical by module name)
4. `src/plugins/` — local plugins (alphabetical by filename)

npm modules declared in `gwen.config.ts → modules` run at **build time** and register their plugins via `gwen.addPlugin()`. Those plugins land in `config.plugins` and execute before any local modules or plugins.

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
