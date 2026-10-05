---
title: The Engine
description: Configuring the GWEN engine with gwen.config.ts and accessing it at runtime.
---

# The Engine

The **GWEN engine** is the runtime that boots your game, loads WASM, manages scenes, and runs your systems each frame. Configuration happens in **`gwen.config.ts`** at build time — you never bootstrap the engine manually.

::: info Import required
`useEngine` is not auto-imported. Import it explicitly when you need direct engine access:
```ts
import { useEngine } from '@gwenjs/core'
```
:::

## Build Configuration

Use `defineConfig()` from `@gwenjs/app` to declare modules and engine options:

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    targetFPS: 60,
  },
})
```

This file is processed at build time by the Vite plugin.

## Config Reference

| Property | Type | Description |
|---|---|---|
| `modules` | `string[]` | Modules to activate (e.g. `['@gwenjs/physics2d']`) |
| `engine.maxEntities` | `number` | Max simultaneous entities (default `10_000`) |
| `engine.targetFPS` | `number` | Target FPS (default `60`) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | WASM variant to load |
| `engine.loop` | `'internal' \| 'external'` | Game loop mode (default `'internal'`) |
| `engine.maxDeltaSeconds` | `number` | Max delta time per frame (default `0.1`) |
| `engine.physicsHz` | `number` | Fixed simulation rate in Hz. `0` = variable dt (default) |
| `engine.maxCatchupSteps` | `number` | Max fixed steps per real frame (default `2`) |
| `engine.debug` | `boolean` | Enable global debug mode |
| `vite` | `object` | Static Vite config extension |
| `hooks` | `Partial<GwenBuildHooks>` | Build-time hook subscriptions |
| `plugins` | `GwenPlugin[]` | Direct plugin registration (escape hatch) |

## Extending Vite

GWEN manages your Vite configuration — no `vite.config.ts` needed. Use the `vite` field for static config:

```ts
export default defineConfig({
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
  },
})
```

For programmatic or conditional config, use the build hook:

```ts
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = { '~assets': './src/assets' }
    },
  },
})
```

## Accessing the Engine at Runtime

Inside a system or actor factory, call `useEngine()` to get the raw engine instance. This is rarely needed — composables like `useQuery`, `useService`, and `useHook` cover most use cases.

```ts
import { useEngine } from '@gwenjs/core'

export const DebugSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    const stats = engine.getStats()
    console.log(`FPS: ${stats.fps}, frame: ${stats.frameCount}`)
  })
})
```

## Frame Stats

`engine.getStats()` returns live performance metrics:

| Field | Type | Description |
|---|---|---|
| `fps` | `number` | Frames per second |
| `frameCount` | `number` | Total frames since start |
| `deltaTime` | `number` | Last frame delta in seconds |
| `overBudget` | `boolean` | Present only when `__GWEN_DEV__` and `debug` are both true. `true` if that frame exceeded the FPS budget |

For external loop mode (`engine.loop: 'external'`), advance frames manually with `engine.advance(delta)`:

```ts
engine.advance(delta)  // tick one frame with the given delta (seconds)
```

## Loop Modes

GWEN supports three loop configurations, set via `engine.loop` and `engine.physicsHz` in `gwen.config.ts`.

### Internal loop (default)

The framework calls `requestAnimationFrame` internally. `onUpdate` receives a variable `dt` each frame.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'internal', targetFPS: 60 },
})
```

### External loop

Set `loop: 'external'` when you control the frame loop yourself — for example inside a custom renderer, a test harness, or a server-side simulation.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'external' },
})
```

The framework calls `engine.startExternal()` instead of `engine.start()`. Drive frames manually:

```ts
// your loop
function tick(dt: number) {
  engine.advance(dt) // seconds
  requestAnimationFrame(() => tick(getDelta()))
}
```

### Fixed timestep

Set `physicsHz` to a non-zero value to enable a fixed-step accumulator loop. `onUpdate` always receives `1 / physicsHz` as `dt`, regardless of actual frame pacing.

```ts
export default defineConfig({
  engine: {
    physicsHz: 60,      // 60 fixed steps per second
    maxCatchupSteps: 2, // at most 2 steps per real frame
  },
})
```

The accumulator pattern:
1. Each real frame, elapsed time accumulates.
2. For each `1 / physicsHz` seconds accumulated, one simulation step fires.
3. If the machine falls behind, `maxCatchupSteps` prevents a runaway catch-up spiral.

`engine.timeScale` still applies: a `timeScale` of `0.5` halves the effective simulation speed.

::: tip When to use physicsHz
Use `physicsHz` when your simulation requires deterministic, reproducible steps — physics, networking, replay. For rendering-only logic, the default variable-dt loop is simpler.
:::

## API Summary

| | |
|---|---|
| `defineConfig(options)` | Build-time framework configuration |
| `useEngine()` | Access raw engine (any engine context) |
| `engine.getStats()` | Live performance metrics |
| `engine.advance(delta)` | Manual frame tick (external loop mode only) |

## Next Steps

- **[Components](/essentials/components)** — Define the data structures your game will use.
- **[Systems](/essentials/systems)** — Write systems to move and update entities.
- **[Scenes](/essentials/scenes)** — Organize your game into distinct states.
- **[Actors](/essentials/actors)** — Create composable, instance-based game objects.
