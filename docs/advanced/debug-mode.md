---
title: Debug Mode
description: Visualize engine state, colliders, and system timing.
---

# Debug Mode

Debug mode enables visual and console diagnostics to understand what's happening inside the engine. When enabled, GWEN displays collider wireframes, system timing overlays, and structured logging—helping you diagnose performance issues and validate logic.

## Enabling Debug Mode

### Global Engine Debug

Set `engine.debug: true` in `gwen.config.ts` to activate engine-wide debug mode. Logger `debug` and `info` follow this flag in every build. These run only when `__GWEN_DEV__` is also true:
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
- System timing appears on screen
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

### System Timing Overlay

GWEN displays per-system execution time in milliseconds:

```
[FRAME 1248] (dt: 16.7ms)
├─ MovementSystem        2.1ms
├─ PhysicsSystem         4.8ms
├─ CollisionSystem       1.3ms
├─ RenderSystem         11.2ms
└─ Total                19.4ms (16% over budget)
```

This helps identify bottlenecks. If a system consistently exceeds its budget (e.g., physics taking 5ms on a 16ms frame), you've found a performance issue.

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
  console.log(p.physics)    // built-in bridge stub only (about 0)
  console.log(p.wasm)       // community WASM module steps
  console.log(p.update)     // update_transforms and engine:update
  console.log(p.render)     // engine:after-update and engine:render
  console.log(p.afterTick)  // engine:afterTick
  console.log(p.total)      // whole _runFrame
}
```

With `physicsHz > 0`, one display frame can run several simulation steps. `getStats()` adds those steps into each `phaseMs` field. `total` covers those steps. `frameCount` counts the steps. `engine:render` still runs once per step, so `phaseMs.render` is the sum of those passes.

> **Note:** Use `engine.getStats()` — not `engine.stats`. It is a method call.

## Structured Logging

GWEN provides a built-in logger via `createLogger()`. Log levels: `debug` < `info` < `warn` < `error`. Each entry is a structured `LogEntry` object, compatible with custom log sinks.

```typescript
import { createLogger } from '@gwenjs/core'

const logger = createLogger('MyPlugin')

logger.debug('initializing...')
logger.info('plugin started')
logger.warn('slow frame detected', { frameMs: 32 })
logger.error('unhandled error', error)
```



```ts
import { createLogger, useEngine } from '@gwenjs/core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const MySystem = defineSystem(function MySystem() {
  const engine = useEngine()
  const log = createLogger('game:my-system')

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

The logger respects the `debug` flag:

| Level | When Active | Use |
|---|---|---|
| `debug` | Only when `debug: true` | Detailed diagnostics (disabled in production) |
| `info` | Only when `debug: true` | Informational events |
| `warn` | Always | Unexpected but recoverable conditions |
| `error` | Always | Problems that need attention |

This means your `log.debug()` calls are no-ops in production, avoiding overhead.

### Custom Log Sinks

Redirect logs to a custom sink (e.g., a server, external service, or test spy):

```ts
import { createLogger } from '@gwenjs/core'

const log = createLogger('app:core', true)

// Replace the default console sink
log.setSink((entry) => {
  console.log(`[${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`)
  if (entry.data) {
    console.table(entry.data)
  }

  // Forward to analytics
  if (entry.level === 'error') {
    analytics.logError(entry.source, entry.message, entry.data)
  }
})

log.error('Critical issue', { userId: 123, errorCode: 'LOAD_FAILED' })
```

## Conditional Features

### Debug stays off unless you set it

`engine.debug` defaults to `false`. A development server does not turn it on.

`__GWEN_DEV__` is the build-time flag. On a build it follows the Vite mode, not `NODE_ENV`. `vite build` (mode `production`) sets it to `false`. `vite build --mode development` sets it to `true`, so a development build keeps every check. On `vite` / `vite dev` it follows Vite's `import.meta.env.DEV`, which is `true`. Vite's own `import.meta.env.DEV` follows `NODE_ENV`, and `vite build` forces `NODE_ENV` to `production`, so it stays `false` on `vite build --mode development` ([Vite: NODE_ENV and Modes](https://vite.dev/guide/env-and-mode#node-env-and-modes)). `GWEN_DEV` from `virtual:gwen/env` has the same value as `__GWEN_DEV__`. Per-frame timing and the WASM memory sentinel run only when both `__GWEN_DEV__` and `debug` are true.

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

2. **Run the game and observe the timing overlay.** Notice `PhysicsSystem` spikes to 8ms when lots of enemies are on screen.

3. **Check the system's logging:**
   ```ts
   const log = createLogger('game:physics', engine.debug)
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

Redirect logs to a test spy:

```ts
import { createLogger } from '@gwenjs/core'
import { describe, it, expect } from 'vitest'

describe('MySystem', () => {
  it('logs initialization', () => {
    const messages: string[] = []
    const log = createLogger('test:system', true)
    log.setSink((entry) => messages.push(entry.message))

    // ... run system setup ...

    expect(messages).toContain('System initialized')
  })
})
```

## Deep Dive

### Performance Impact

Debug mode has measurable overhead:
- Collider rendering: ~1–2ms per frame
- Timing overlay: <0.1ms
- Structured logging: Negligible if filtered at runtime

Production builds (`__GWEN_DEV__ === false`) remove dev-only warnings and the per-frame instrumentation, even when `debug` is `true`. Logger `debug` and `info` still follow `engine.debug`.

### Sentinel Checks

When `__GWEN_DEV__` and `debug: true`, GWEN checks the WASM memory sentinel after each frame. It does not bounds-check component arrays and it does not verify that entity IDs exist. The check is absent from production builds.

## API Summary

| Function | Description |
|---|---|
| `defineConfig({ debug })` | Enable/disable debug mode |
| `createLogger(source, debugMode)` | Create a logger instance |
| `logger.debug(msg, data?)` | Log only when debug mode is on |
| `logger.info(msg, data?)` | Informational log (debug-only) |
| `logger.warn(msg, data?)` | Warning log (always active) |
| `logger.error(msg, data?)` | Error log (always active) |
| `logger.child(source)` | Create a scoped child logger |
| `logger.setSink(callback)` | Redirect logs to custom sink |
| `__GWEN_DEV__` | Build-time flag. `true` in dev, `false` in production |

## Next Steps

- **[Actor Leak Detection](/advanced/actor-leak-detection)** — Detect unbounded actor growth with `watchActorLeaks`.
- **[Error Bus](/advanced/error-bus)** — Structured error handling alongside logging.
- **[Systems](/essentials/systems)** — Write systems that log and profile efficiently.
