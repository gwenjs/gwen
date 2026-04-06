---
title: The Engine
description: Creating and configuring the GWEN engine instance, and how it manages the game loop.
---

# The Engine

The **GWEN engine** is the runtime that boots your game, loads WASM, manages scenes, and runs your systems each frame. Engine setup happens in two places: **`gwen.config.ts`** (build-time) and **`main.ts`** (runtime bootstrap).

## Two-Part Setup

### Part 1: Build Configuration — `gwen.config.ts`

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

### Part 2: Runtime Bootstrap — `main.ts`

In your entry point, import and create the engine **separately**:

```ts
import { createEngine } from '@gwenjs/core'
import { Physics2DPlugin } from '@gwenjs/physics2d'
import { AppRouter } from './router'

const engine = await createEngine({
  maxEntities: 10_000,
  variant: 'physics2d',
})

// Mount plugins
await engine.use(Physics2DPlugin())

// Mount scene router
await engine.use(AppRouter)

// Start the game loop
await engine.start()
```

**Key distinction:** `createEngine()` accepts `GwenEngineOptions` (runtime parameters), NOT `GwenUserConfig`. They are completely separate APIs.

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

## Runtime Config: `GwenEngineOptions`

Used in **`createEngine()`** at runtime. Configures the engine instance.

| Property | Type | Description |
|---|---|---|
| `maxEntities` | `number` | Max simultaneous entities |
| `targetFPS` | `number` | Target frames per second |
| `variant` | `'light' \| 'physics2d' \| 'physics3d'` | WASM variant |
| `debug` | `boolean` | Enable debug logging and checks |
| `enableStats` | `boolean` | Collect performance statistics (default true) |
| `sparseTransformSync` | `boolean` | Only sync changed transforms (default true) |
| `loop` | `'internal' \| 'external'` | Game loop mode (default 'internal') |
| `maxDeltaSeconds` | `number` | Max delta per frame (default 0.1s) |
| `tweenPoolSize` | `number` | Pre-allocated tween slots (default 256) |

**Example:**
```ts
const engine = await createEngine({
  maxEntities: 10_000,
  targetFPS: 60,
  variant: 'physics2d',
  debug: true,
  loop: 'internal',
})
```

## Internal vs External Loop Mode

By default, GWEN owns `requestAnimationFrame`. Use `loop: 'external'` to drive the loop yourself:

```ts
// Internal loop mode (default)
const engine = await createEngine({ loop: 'internal' })
await engine.start()

// External loop mode
const engine = await createEngine({ loop: 'external' })
function gameLoop(delta: number) {
  engine.advance(delta)
  requestAnimationFrame(gameLoop)
}
requestAnimationFrame(gameLoop)
```

## Mounting Plugins and Routers

After creation, mount plugins and routers before calling `engine.start()`:

```ts
const engine = await createEngine({ variant: 'physics2d' })

// Mount a plugin
await engine.use(Physics2DPlugin())

// Mount a scene router
await engine.use(AppRouter)

// Now start the game loop
await engine.start()
```

## Accessing the Engine in Systems

Inside a system's setup function, use `useEngine()` to access the engine instance:

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

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

When you call `engine.start()`:

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

### External Loop (Advanced)

```ts
const engine = await createEngine({ loop: 'external' })

let lastTime = performance.now()
function tick(now: number) {
  const delta = (now - lastTime) / 1000  // Convert to seconds
  lastTime = now
  engine.advance(delta)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
```

## API Summary

| Function | Returns | Description |
|---|---|---|
| `createEngine(options)` | `Promise<GwenEngine>` | Create and initialize the engine |
| `engine.use(plugin)` | `Promise<void>` | Mount a plugin or router |
| `engine.start()` | `Promise<void>` | Start the game loop |
| `engine.pause()` | `void` | Pause the game loop |
| `engine.resume()` | `void` | Resume the game loop |
| `engine.advance(delta)` | `void` | Manual frame advance (external loop mode) |
| `engine.getStats()` | `EngineStats` | Get performance metrics |
| `engine.spawn(components)` | `number` | Create a new entity |
| `engine.destroy(id)` | `void` | Delete an entity |
| `useEngine()` | `GwenEngine` | Access engine from inside a system |

## Next Steps

- **[Components](/essentials/components)** — Define data structures for your entities.
- **[Systems](/essentials/systems)** — Write systems to move and update entities.
- **[Scenes](/essentials/scenes)** — Organize your game into distinct states.
- **[Actors](/essentials/actors)** — Create composable, instance-based game objects.
