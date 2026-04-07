---
title: The Engine
description: Creating and configuring the GWEN engine instance, and how it manages the game loop.
---

# The Engine

The **GWEN engine** is the runtime that boots your game, loads WASM, manages scenes, and runs your systems each frame. Engine configuration happens in **`gwen.config.ts`** at build time — you never bootstrap the engine manually.

## Build Configuration — `gwen.config.ts`

Use `defineConfig()` from `@gwenjs/app` to declare modules, WASM variant, and build-time settings:

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],        // Activates physics module
  engine: {
    maxEntities: 10_000,                  // Optional engine config
    variant: 'physics2d',                 // WASM variant
  },
})
```

The config file is processed **at build time** by Vite and sets up module resolution.

## Build-Time Config: `GwenUserConfig`

Used in **`gwen.config.ts`** only. Configures modules, WASM variant, and build hooks.

| Property | Type | Description |
|---|---|---|
| `modules` | `GwenModuleEntry[]` | List of modules to activate (e.g., `['@gwenjs/physics2d']`) |
| `engine.maxEntities` | `number` | Max simultaneous entities (default 10_000) |
| `engine.targetFPS` | `number` | Target FPS (default 60) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | WASM variant to load |
| `engine.loop` | `'internal' \| 'external'` | Game loop ownership (default 'internal') |
| `engine.maxDeltaSeconds` | `number` | Max delta time per frame (default 0.1s) |
| `vite` | `Record<string, unknown>` | Direct Vite config extension |
| `hooks` | `Partial<GwenBuildHooks>` | Build-time hook subscriptions |
| `plugins` | `GwenPlugin[]` | Direct plugin registration (escape hatch) |

**Example:**
```ts
export default defineConfig({
  modules: [
    '@gwenjs/physics2d',
    ['@gwenjs/input', { gamepad: true }],
  ],
  engine: {
    maxEntities: 5_000,
    targetFPS: 60,
    variant: 'physics2d',
  },
  vite: {
    // Direct Vite config
  },
})
```

## Accessing the Engine in Systems

Inside a system's setup function, use `useEngine()` to access the engine instance:

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    // Run every frame
  })
})
```

From the engine, you can:

- Get **stats** — `engine.getStats()` (fps, frameCount, entityCount, etc.)
- **Spawn/destroy entities** — `engine.spawn()`, `engine.destroy()`
- Access **plugins** — `engine.getPlugin(PhysicsPlugin)`
- **Control the loop** — `engine.pause()`, `engine.resume()`, `engine.advance(delta)` (external mode)

## Engine Lifecycle

When the game boots:

1. **Initialize** — Set up WASM heap, internal systems
2. **Plugin Setup** — Call setup on each mounted plugin
3. **Enter Initial Scene** — Load first router state or scene
4. **Game Loop** — Each frame:
   - Call `onUpdate(dt)` on all systems
   - Update components
   - Render (if canvas is attached)
   - Physics simulation (if physics plugin is mounted)

## Common Engine Tasks

### Getting Engine Stats

```ts
const stats = engine.getStats()
console.log(`FPS: ${stats.fps}`)
console.log(`Entities: ${stats.entityCount}`)
console.log(`Delta: ${stats.deltaTime}s`)
```

### Pausing and Resuming

```ts
engine.pause()
engine.resume()
```

## API Summary

| Function | Returns | Description |
|---|---|---|
| `engine.pause()` | `void` | Pause the game loop |
| `engine.resume()` | `void` | Resume the game loop |
| `engine.advance(delta)` | `void` | Manual frame advance (external loop mode) |
| `engine.getStats()` | `EngineStats` | Get performance metrics |
| `engine.spawn(components)` | `number` | Create a new entity |
| `engine.destroy(id)` | `void` | Delete an entity |
| `useEngine()` | `GwenEngine` | Access engine from inside a system |

## Extending Vite

GWEN manages your Vite configuration internally — you don't need a `vite.config.ts` file. To extend it, use the `vite` field in `gwen.config.ts`:

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
  },
})
```

For build hooks, use the `hooks` field:

Use `vite` for static configuration. Use `hooks['vite:extendConfig']` when you need conditional or programmatic config.

```typescript
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = { '~assets': './src/assets' }
    },
  },
})
```

For complete Vite extension patterns (including module-level extension), see [Extending Vite](/advanced/vite-config).

## Next Steps

- **[Components](/essentials/components)** — Define data structures for your entities.
- **[Systems](/essentials/systems)** — Write systems to move and update entities.
- **[Scenes](/essentials/scenes)** — Organize your game into distinct states.
- **[Actors](/essentials/actors)** — Create composable, instance-based game objects.
