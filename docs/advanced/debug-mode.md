---
title: Debug Mode
description: Visualize engine state, colliders, and system timing.
---

# Debug Mode

Debug mode enables visual and console diagnostics to understand what's happening inside the engine. When enabled, GWEN displays collider wireframes, system timing overlays, and structured logging—helping you diagnose performance issues and validate logic.

## Enabling Debug Mode

### Global Engine Debug

Set `engine.debug: true` in `gwen.config.ts` to activate engine-wide debug mode. This enables:
- Verbose logging for plugin registration and lifecycle events
- Per-frame sentinel checks
- Phase timing warnings when frame budget is exceeded

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

Individual modules may also expose their own `debug` option via the module tuple:

```typescript
export default defineConfig({
  modules: [['@gwenjs/physics2d', { debug: true }]],
})
```

This enables the physics debug renderer (collision shape overlays) independently of the global engine debug flag.

## The Basics

Enable debug mode in your engine configuration:

```ts
// gwen.config.ts
export default defineConfig({
  modules: [['@gwenjs/physics2d', { debug: true }]],
})
```

When `debug: true`:
- Physics colliders render as colored wireframes
- System timing appears on screen
- Verbose logging is active
- Sentinel checks validate data integrity

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

console.log(stats.fps)           // current FPS
console.log(stats.deltaTime)     // last frame delta in ms
console.log(stats.frameCount)    // total frames since start
console.log(stats.budgetMs)      // frame budget (1000 / targetFPS)
console.log(stats.overBudget)    // true if last frame exceeded budget

// Per-phase breakdown (all in ms)
const p = stats.phaseMs
console.log(p.tick)       // engine:tick hook
console.log(p.plugins)    // onBeforeUpdate() calls
console.log(p.physics)    // physics2d/3d step
console.log(p.wasm)       // WASM module steps
console.log(p.update)     // onUpdate() calls
console.log(p.render)     // onAfterUpdate() + onRender() calls
console.log(p.afterTick)  // engine:afterTick hook
console.log(p.total)      // full frame wall-clock time
```

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
import { createLogger, defineSystem, useEngine } from '@gwenjs/core'

export const MySystem = defineSystem(() => {
  const engine = useEngine()
  const log = createLogger('game:my-system', engine.debug)

  onStart(() => {
    log.info('System initialized', { entityCount: 42 })
    log.debug('Detailed initialization data', { config: {...} })
  })

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

### Environment-Based Debugging

Use `process.env.NODE_ENV` to enable debug features only during development:

```ts
// gwen.config.ts
export default defineConfig({
  engine: {
    debug: process.env.NODE_ENV !== 'production',
  },
  modules: [['@gwenjs/physics2d', {}]],
})
```

Now:
- Development builds (`npm run dev`) have `debug: true`
- Production builds (`npm run build`) have `debug: false`

### Conditional System Registration

Register debug-only systems:

```ts
import { defineScene } from '@gwenjs/core'

export class GameScene extends defineScene {
  onLoad() {
    this.addSystem(GameplaySystem)

    if (import.meta.env.DEV) {
      this.addSystem(DebugVisualizationSystem)
      this.addSystem(PerformanceProfilingSystem)
    }
  }
}
```

### Runtime Debug Toggle

Allow players to toggle debug visuals in-game:

```ts
import { useEngine, defineSystem, onUpdate } from '@gwenjs/core'

export const DebugToggleSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyPressed('F1')) {
      engine.config.debug = !engine.config.debug
    }
  })
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
import { defineScene, createEntity } from '@gwenjs/core'
import { Position, Collider } from './components'

export class TestScene extends defineScene {
  onLoad() {
    // Create an entity with a collider
    const id = createEntity()
    Position.set(id, { x: 100, y: 100 })
    Collider.set(id, { type: 'box', w: 50, h: 50 })

    // In debug mode, the collider renders visually
    // You can immediately see if the collider is positioned/sized correctly
  }
}
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

Use `import.meta.env.DEV` to disable all overhead in production.

### Sentinel Checks

When `debug: true`, GWEN performs extra validation:
- Component arrays are bounds-checked
- Entity IDs are verified to exist
- WASM memory layout is inspected for corruption

These checks catch bugs early but add ~5–10% overhead.

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
| `import.meta.env.DEV` | Vite flag for development builds |

## Next Steps

- **[Error Bus](/advanced/error-bus)** — Structured error handling alongside logging.
- **[Systems](/essentials/systems)** — Write systems that log and profile efficiently.
