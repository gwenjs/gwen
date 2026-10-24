---
title: Debug Mode
description: Visualize engine state, colliders, and phase timings.
---

# Debug Mode

Debug mode enables visual and console diagnostics to understand what's happening inside the engine. When enabled, GWEN displays collider wireframes and structured logging. Phase timings are numbers on `engine.getStats()`. They are not broken down per system.

## Enabling Debug Mode

### Global Engine Debug

Set `engine.debug: true` in `gwen.config.ts` to activate engine-wide debug mode. When `logger.minLevel` is omitted, this lowers the engine logger minimum level to `debug`, so `debug` and `info` are delivered. A set `logger.minLevel` wins. These run only when `__GWEN_DEV__` is also true:
- Per-frame sentinel checks
- Phase timing warnings when the frame budget is exceeded
- The isolation warning (`isolated after …`)

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  engine: {
    debug: true,
  },
})
```

### Module Debug

Individual modules may also expose their own `debug` option. Set it at the module's top-level config key:

```typescript
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: { debug: true },
})
```

This enables the physics debug renderer (collision shape overlays) independently of the global engine debug flag.

## The Basics

Enable debug mode in your engine configuration:

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: { debug: true },
})
```

When `debug: true`:
- Physics colliders render as colored wireframes
- Verbose logging is active
- The WASM memory sentinel is checked only when `__GWEN_DEV__` is also true. Component arrays are not bounds-checked, and entity IDs are not verified.

## Visual Debugging

### Collider Visualization

With debug mode on, physics bodies are drawn with wireframes:

```ts
// Physics automatically renders colliders when debug: true
const world = usePhysics2D()
// All boxes, circles, and polygons are now visible
```

Colors indicate body type:
- **Blue** — Static bodies (immovable)
- **Green** — Dynamic bodies
- **Yellow** — Kinematic bodies (player-controlled)
- **Red** — Sleeping bodies

## Engine Stats

Access per-frame performance data via `engine.getStats()`:

```typescript
const stats = engine.getStats()

console.log(stats.fps)              // smoothed FPS from the raw frame
console.log(stats.rawFrameTime)     // uncapped, unscaled frame duration in seconds
console.log(stats.deltaTime)        // last step in seconds, after the cap and timeScale
console.log(stats.frameCount)       // completed frames
console.log(stats.entityCount)      // alive entities at this call
console.log(stats.budgetMs)         // frame budget (1000 / targetFPS)
console.log(stats.wasmMemoryBytes)  // linear memory bytes, or undefined
console.log(stats.overBudget)       // set only when __GWEN_DEV__ && debug

// Per-phase breakdown (all in ms). Present only when __GWEN_DEV__ and debug are both true.
const p = stats.phaseMs
if (p) {
  console.log(p.tick)       // engine:tick
  console.log(p.plugins)    // engine:before-update, including the physics step and kinematic sync
  console.log(p.wasm)       // community WASM module steps
  console.log(p.update)     // update_transforms and engine:update
  console.log(p.render)     // engine:after-update and engine:render
  console.log(p.afterTick)  // engine:afterTick
  console.log(p.total)      // whole _runFrame
}
```

With `physicsHz > 0`, one display frame can run several simulation steps. `getStats()` adds those steps into each `phaseMs` field. `total` covers the steps and the render pass. `frameCount` counts the steps. `engine:render` runs once per display frame, so `phaseMs.render` includes that single pass.

> **Note:** Use `engine.getStats()` — not `engine.stats`. It is a method call.

`phaseMs` is omitted when `debug` is off. There is no `physics` field. The fields are `tick`, `plugins`, `wasm`, `update`, `render`, `afterTick`, and `total`.

```ts run
import assert from "node:assert/strict";

const hasPhases = "phaseMs" in engine.getStats();
assert.equal(hasPhases, false);
```

## Structured Logging

GWEN provides a built-in logger via `createLogger(tag, options?)`. Log levels: `debug` < `info` < `warn` < `error`. The default minimum level is `warn`, so `debug` and `info` are dropped. Each entry goes to the providers you pass. The default provider writes to the console. `providers: []` delivers nothing.

```typescript
import { createLogger } from '@gwenjs/core'

const logger = createLogger('MyPlugin', { minLevel: 'debug' })

logger.debug('initializing...')
logger.info('plugin started')
logger.warn('slow frame detected', { frameMs: 32 })
logger.error('unhandled error', { reason: 'load failed' })
```

```ts
import { createLogger, useEngine } from '@gwenjs/core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const MySystem = defineSystem(function MySystem() {
  const engine = useEngine()
  const log = createLogger('game:my-system', { minLevel: 'info' })

  // This runs once during setup
  log.info('System initialized')

  onUpdate(() => {
    if (someWarning) {
      log.warn('Unexpected state detected', { state: 'foo' })
    }
  })
})
```

### Log Levels

`createLogger` keeps entries at or above `minLevel`. The default is `warn`.

| Level | When it is delivered | Use |
|---|---|---|
| `debug` | `minLevel` is `debug` | Detailed diagnostics |
| `info` | `minLevel` is `debug` or `info` | Informational events |
| `warn` | `minLevel` is `debug`, `info`, or `warn` | Unexpected but recoverable conditions |
| `error` | Always, for a non-empty `providers` list | Problems that need attention |

`log.debug()` does nothing unless `minLevel` is `debug`.

### Custom providers

Pass a provider to send entries somewhere other than the console:

```ts
import { createLogger } from '@gwenjs/core'
import type { GwenLogEntry } from '@gwenjs/schema'

const log = createLogger('app:core', {
  minLevel: 'debug',
  providers: [
    {
      handle(entry: GwenLogEntry) {
        console.log(`[${entry.level.toUpperCase()}] ${entry.tag}: ${entry.message}`)
        if (entry.payload) {
          console.table(entry.payload)
        }
        if (entry.level === 'error' && entry.tag !== undefined) {
          analytics.logError(entry.tag, entry.message, entry.payload)
        }
      },
    },
  ],
})

log.error('Critical issue', { userId: 123, errorCode: 'LOAD_FAILED' })
```

## Conditional Features

### Debug stays off unless you set it

`engine.debug` defaults to `false`. A development server does not turn it on.

`__GWEN_DEV__` is the build-time flag. On a build it follows the Vite mode, not `NODE_ENV`. `vite build` (mode `production`) sets it to `false`. `vite build --mode development` sets it to `true`, so a development build keeps every check. On `vite` / `vite dev` it follows Vite's `import.meta.env.DEV`, which is `true`. Vite's own `import.meta.env.DEV` follows `NODE_ENV`, and `vite build` defaults `NODE_ENV` to `production` when it is unset, so it stays `false` on `vite build --mode development` ([Vite: NODE_ENV and Modes](https://vite.dev/guide/env-and-mode#node-env-and-modes)). Migration: `NODE_ENV=development vite build` (or `NODE_ENV=development` in `.env`) now gives `false`; pass `--mode development` instead. A mode other than `development` (for example `staging`) gives `false`. `GWEN_DEV` from `virtual:gwen/env` has the same value as `__GWEN_DEV__`. Per-frame timing and the WASM memory sentinel run only when both `__GWEN_DEV__` and `debug` are true.

### Conditional System Registration

Register debug-only systems:

```ts
import { defineScene } from '@gwenjs/core/scene'

export const GameScene = defineScene({
  name: 'game',
  systems: [
    GameplaySystem,
    ...(__GWEN_DEV__ ? [DebugVisualizationSystem, PerformanceProfilingSystem] : []),
  ],
})
```

## In Practice

### Profiling a Performance Problem

You've noticed frame rate drops. Debug mode helps:

1. **Enable debug mode:**
   ```ts
   debug: true
   ```

2. **Read `engine.getStats().phaseMs`.** With `debug` on, the fields are `tick`, `plugins`, `wasm`, `update`, `render`, `afterTick`, and `total`.

3. **Check the system's logging:**
   ```ts
   const log = createLogger('game:physics', { minLevel: engine.debug ? 'debug' : 'warn' })
   onUpdate(() => {
     log.debug('Physics step', { bodyCount: physics.bodyCount() })
   })
   ```

4. **Analyze the logs.** You discover that body count jumps from 10 to 200 when enemies spawn, and physics thrashes.

5. **Fix:** Reduce the number of active physics bodies or use spatial partitioning.

### Validating Collisions

Collider wireframes help verify collision geometry:

```ts
import { defineScene } from '@gwenjs/core/scene'

export const TestScene = defineScene({
  name: 'test',
  systems: [ColliderTestSystem],
})

// In your test system, spawn entities normally.
// When debug: true is set, physics colliders render as wireframes automatically.
```

### Filtering Logs During Testing

Pass a capture provider:

```ts
import { createLogger } from '@gwenjs/core'
import type { GwenLogEntry } from '@gwenjs/schema'
import { describe, it, expect } from 'vitest'

describe('MySystem', () => {
  it('logs initialization', () => {
    const messages: string[] = []
    const log = createLogger('test:system', {
      minLevel: 'info',
      providers: [
        {
          handle(entry: GwenLogEntry) {
            messages.push(entry.message)
          },
        },
      ],
    })

    log.info('System initialized')

    expect(messages).toContain('System initialized')
  })
})
```

## Deep Dive

### Performance Impact

Debug mode has measurable overhead:
- Collider rendering: ~1–2ms per frame
- Structured logging: Negligible if filtered at runtime

Production builds (`__GWEN_DEV__ === false`) remove dev-only warnings and the per-frame instrumentation, even when `debug` is `true`. When `logger.minLevel` is omitted, logger `debug` and `info` still follow `engine.debug`. A set `logger.minLevel` wins.

### Sentinel Checks

When `__GWEN_DEV__` and `debug: true`, GWEN checks the WASM memory sentinel after each frame. It does not bounds-check component arrays and it does not verify that entity IDs exist. The check is absent from production builds.

## API Summary

| Function | Description |
|---|---|
| `defineConfig({ debug })` | Enable/disable debug mode |
| `createLogger(tag, options?)` | Create a logger. Default `minLevel` is `warn`. Default provider is the console. |
| `logger.debug(msg, payload?)` | Delivered when `minLevel` is `debug` |
| `logger.info(msg, payload?)` | Delivered when `minLevel` is `debug` or `info` |
| `logger.warn(msg, payload?)` | Delivered when `minLevel` allows `warn` |
| `logger.error(msg, payload?)` | Delivered when `minLevel` allows `error` |
| `logger.child(tag, entityId?)` | Child sharing providers, minimum level and frame getter |
| `options.providers` | Objects with `handle(entry)`. `[]` delivers nothing. |
| `__GWEN_DEV__` | Build-time flag. `true` in dev, `false` in production |

## Next Steps

- **[Actor Leak Detection](/advanced/actor-leak-detection)** — Detect unbounded actor growth with `watchActorLeaks`.
- **[Error Bus](/advanced/error-bus)** — Structured error handling alongside logging.
- **[Systems](/essentials/systems)** — Write systems that log and profile efficiently.
