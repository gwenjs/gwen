---
title: Error Bus
description: Structured, non-fatal error reporting across the engine.
---

# Error Bus

GWEN's error bus provides a structured way for the engine, plugins, and game code to emit and handle errors gracefully. Instead of throwing exceptions (which halt the game), errors are emitted as events that your code can listen to and respond to—keeping the game running even when something goes wrong.

A thrown `GwenError` uses one grammar: `[where] what`, then `Fix:` when a dev hint is set, then `See <docsUrl> (<code>)`. `where` is the composable name, or `GWEN`. Compare `code`, not the sentence.

A physics2d call you make yourself throws `GwenWasmError`. `code` is `PHYSICS2D:*` and `exportName` is the WASM export. Catch that call.

A physics3d call you make yourself does the same: it throws `GwenWasmError` with a `PHYSICS3D:*` code. See [Errors](/api/physics3d#errors).

`physics_step` and `physics3d_step` run inside `engine:before-update`. A rejected step is isolated: the frame continues, and `engine.errors` receives a hook error. The event `code` is `CORE:FRAME_LOOP_ERROR` and `error` is the `GwenWasmError`.

A trap throws `GwenWasmPanicError` and poisons the bridge. The bus event `code` is `CORE:WASM_PANIC`.

## The Basics

Access the error bus through the engine:

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const ErrorHandlingSystem = defineSystem(() => {
  const engine = useEngine()

  // Listen for errors emitted by the engine or plugins
  engine.errors.on((error) => {
    console.warn(`[${error.level}] ${error.code}: ${error.message}`)

    if (error.level === 'fatal') {
      // Perform cleanup or show an error screen
      showErrorDialog(error.message)
    }
  })
})
```

The error bus emits events with a consistent structure:

```ts
interface ErrorEvent {
  level: 'fatal' | 'error' | 'warning' | 'info' | 'verbose'
  code: string           // e.g., 'CORE:FRAME_LOOP_ERROR'
  message: string        // Human-readable description
  source?: string        // Which plugin emitted this
  error?: unknown        // The underlying Error object, if any
  context?: Record<string, unknown>  // Additional debug data
}
```

## Listening to Errors

Register a handler that receives all error events:

```ts
engine.errors.on((event) => {
  if (event.code === 'GAME:ASSET_MISSING') {
    // Handle a code your game emitted
    reloadAsset()
  }

  if (event.level === 'error') {
    // Log to telemetry service
    analytics.logError(event.code, event.context)
  }
})
```

### Core Error Codes

The engine emits errors using `CoreErrorCodes`:

```ts
import { CoreErrorCodes } from '@gwenjs/core'

// Available codes:
CoreErrorCodes.FRAME_LOOP_ERROR     // Something went wrong during frame advance
CoreErrorCodes.PLUGIN_SETUP_ERROR   // Plugin threw during engine.use()
CoreErrorCodes.PLUGIN_RUNTIME_ERROR // Plugin threw during a frame callback
CoreErrorCodes.WASM_LOAD_ERROR      // WASM module failed to load
CoreErrorCodes.WASM_TIMEOUT         // WASM module did not initialise in time
CoreErrorCodes.WASM_PANIC           // Rust panic propagated from WASM
CoreErrorCodes.WASM_NOT_INITIALIZED // engine.start() before the bridge is active
```

`CORE:STORAGE_INCONSISTENT` means the component store broke an invariant a normal call cannot build (a slot pointing at a missing chunk or row, a lane that disappeared, a count above the row length, a moved entity with no slot). A dead entity, a stale generation, and an absent component are not this code. Treat it as a bug in the engine and report it. The Rust error carries a stable `site` number. A running engine moves to `faulted`.

`CORE:QUERY_PER_ENTITY_PATH` is a dev-only warning on `engine.errors`. It is not thrown and it is not fatal. It fires once per engine per api during `engine:before-update`, `engine:update`, or `engine:after-update`. Deprecated: `useComponentFor`. It is the second api, next to `Query.each`.

`CORE:QUERY_INVALID` has two origins and stays one code. Rust: the chunk store rejected an empty type list or an unknown handle. TypeScript: a query used after release or engine stop, a chunk used after its loop step, or `entityId(row)` outside `[0, count)`.

Plugins define their own error codes following the same pattern: `'PLUGIN_NAME:ERROR_TYPE'`.

## Emitting Errors

Plugins and game code can emit structured errors instead of throwing:

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const CustomSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (invalidState) {
      engine.errors.emit({
        level: 'warning',
        code: 'GAME:INVALID_STATE',
        message: 'Entity has conflicting components',
        source: 'game:validation',
        context: {
          entityId: entity.id,
          components: ['Health', 'DeadTag'],
        }
      })
    }
  })
})
```

By emitting instead of throwing:
- The game loop continues uninterrupted
- Other systems still update
- Handlers can decide how to respond (log, alert, recover)
- Multiple errors can accumulate and be reported together

## Why Not Throw?

Throwing exceptions halts the game immediately. In a live game, this means:
- Players see a frozen screen
- No recovery is possible
- Telemetry is lost

With the error bus:
- The game stays responsive
- Your error handler can attempt recovery (restart a subsystem, reload a scene)
- Error events are structured for telemetry (Sentry, Datadog, custom analytics)
- Players get a helpful error message, not a crash

## In Practice

### A call you make throws

There is no `PHYSICS:STEP_FAILED` event and no `PHYSICS:INVALID_SHAPE` event. Catch the call you made. The plugin does not copy that throw onto the bus.

```ts
import { GwenWasmError } from '@gwenjs/core'
import { usePhysics2D } from '@gwenjs/physics2d'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const PathSystem = defineSystem(() => {
  const physics = usePhysics2D()

  onUpdate(() => {
    try {
      physics.findPath({ x: 0, y: 0 }, { x: 10, y: 0 })
    } catch (err) {
      if (err instanceof GwenWasmError && err.code === 'PHYSICS2D:INVALID_PATH_REQUEST') {
        // Recover here. This call's throw is not a bus event.
      }
    }
  })
})
```

### The physics step is a hook error

`physics_step` is not a call you make. It runs in `engine:before-update`. A rejected step is isolated: the frame continues, and `engine.errors` receives the hook error. `event.code` is `CORE:FRAME_LOOP_ERROR`. `event.error` is the `GwenWasmError` (`PHYSICS2D:*`, `exportName` `physics_step`). `event.context.hook` is `engine:before-update`.

A trap is `GwenWasmPanicError`. The bridge is poisoned. The bus event `code` is `CORE:WASM_PANIC`.

`PHYSICS2D:INVALID_QUERY` is a coordinate that is not finite or outside ±1e7, or a half-extent/radius that is not finite, negative, or above 1e7. `PHYSICS2D:INVALID_STEP_DELTA` is a step `delta` that is not finite or sits outside 0 to 1. The world is unchanged. A body that leaves the world during play is not one of these errors. The plugin emits `physics2d:body-disabled` with `{ entity, reason }` where `reason` is `non-finite`, `out-of-bounds`, or `velocity`.

`PHYSICS3D:INVALID_QUERY` is a ray or point coordinate that is not finite or outside ±1e7, a direction that is not finite or is zero, or a max distance that is not finite or is negative. A shape-cast pose or size uses `PHYSICS3D:INVALID_COLLIDER`. `PHYSICS3D:INVALID_STEP_DELTA` is a step `delta` that is not finite or sits outside 0 to 1. The world is unchanged. A body that leaves the world during play is not one of these errors. The plugin emits `physics3d:body-disabled` with `{ entity, reason }` where `reason` is `non-finite`, `out-of-bounds`, or `velocity`. A mesh vertex is refused above 1e9 by `trimesh_builder` (`crates/gwen-core/src/physics3d/world.rs:529-531`, `check_collider_coordinate`). `decoded_mesh_is_valid` applies that cap on `load_bvh_collider` (`world.rs:614-617`). parry3d-0.31.1 `query/point/point_composite_shape.rs:199-202` returns a point when the projection is missing (`point_projection_on_a_large_mesh_does_not_panic`). Probe cases `mesh pose fixed 1e19 1m`, `mesh pose fixed 1e19 cap`, `mesh pose fixed 1e30 1m`, `mesh pose fixed 1e30 cap`, `mesh pose fixed max 1m`, `mesh pose fixed max cap`, `mesh pose kinematic 1e19 1m` and `mesh pose kinematic 1e19 cap` (`physics3d_float_probe.rs`) use a pose up to `f32::MAX` and do not panic. The query-point cap of ±1e7 is a separate input guard.

```ts
engine.errors.on((event) => {
  if (event.context?.hook !== 'engine:before-update') return
  const cause = event.error
  if (cause instanceof GwenWasmError && cause.exportName === 'physics_step') {
    // The step was rejected. The frame still finished this hook.
  }
})
```

### Error Telemetry

Forward errors to your analytics backend:

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const TelemetrySystem = defineSystem(() => {
  const engine = useEngine()

  engine.errors.on((event) => {
    // Only report errors and above
    if (['error', 'fatal'].includes(event.level)) {
      fetch('/api/errors', {
        method: 'POST',
        body: JSON.stringify({
          timestamp: Date.now(),
          code: event.code,
          message: event.message,
          level: event.level,
          context: event.context,
          stacktrace: event.error instanceof Error
            ? event.error.stack
            : undefined
        })
      })
    }
  })
})
```

### Fatal Error Recovery

When a fatal error occurs, show an error dialog and optionally reload:

```ts
engine.errors.on((event) => {
  if (event.level === 'fatal') {
    showErrorDialog({
      title: 'Game Error',
      message: event.message,
      code: event.code,
      onRetry: () => location.reload(),
      onMenu: () => loadScene('MainMenu')
    })
  }
})
```

## Deep Dive

### Error Levels

- **`verbose`** — Extremely detailed diagnostics (only in debug builds)
- **`info`** — Informational events (e.g., "Physics initialized")
- **`warning`** — Something unexpected but recoverable
- **`error`** — A problem that needs attention
- **`fatal`** — The engine enters `faulted` and the loop stops. `stop()` is not called. Create a new engine.

| Case | What happens |
|---|---|
| level `fatal` | The engine enters `faulted`. `stop()` is not called |
| a handler throws | Logged as `CORE:ERROR_HANDLER_FAILED`. The throw does not escape `emit` |
| `engine.isolated()` | The `GwenErrorTarget` values skipped after an error (`kind`, `id`, `name`) |
| `engine.reenable(id)` | Clears that id. Returns `false` when the id is not isolated. A system `resume()` does not clear isolation |
| dead physics2d entity | The call throws `Physics2DStaleEntityError` with code `PHYSICS2D:STALE_ENTITY` |

```ts check
import { Physics2DStaleEntityError } from "@gwenjs/physics2d";

export function staleCode(error: Physics2DStaleEntityError): string {
  return error.code;
}
```

```ts run
import assert from "node:assert/strict";

assert.equal(engine.reenable("missing"), false);
assert.equal(engine.state, "idle");
```

### Fatal Error Handler

Register a callback that runs after every `on` handler when the event level is `fatal`:

```ts
engine.errors.onFatal(() => {
  // Cleanup: save game state, disconnect from server, etc.
  saveGameState()
  disconnectNetwork()
})
```

`emit` runs every `on` handler first, then every `onFatal` callback. Both run synchronously inside `emit`. A handler that throws is caught. The other handlers still run, and the frame loop keeps going.

A custom bus passed as `errorBus` must implement `on()` and `onFatal()`. The engine calls `on()` to log and isolate. `onFatal()` moves a non-terminal engine to `faulted` and does not call `stop()`. The engine subscribes in the constructor. `stop()` unsubscribes. `start()` after `stop()` rejects, so create a new engine. `stop()` also restores `emit` when the engine wrapped it so `engine:error` runs after the `on` handlers.

### Installation

`createEngine()` calls `install()` when `window` exists. You do not call it yourself.

`install()` attaches `window.onerror` and `unhandledrejection`, and forwards those failures onto the bus. It returns a function that removes those handlers. `stop()` calls that function.

## API Summary

| Method | Description |
|---|---|
| `engine.errors.emit(event)` | Emit a structured error event. `on` handlers run first, then `onFatal` on a fatal event. A throwing handler is caught. |
| `engine.errors.on(handler)` | Register an error listener. Required on every bus, including a custom `errorBus`. |
| `engine.errors.onFatal(cb)` | Run cleanup after `on` handlers when the level is `fatal` |
| `engine.errors.install?.()` | Install global error handlers. `createEngine()` does this when `window` exists. |

## Next Steps

- **[Debug Mode](/advanced/debug-mode)** — Engine-wide debug flags and logging.
- **[Logging](/advanced/debug-mode)** — Use structured logging alongside error reporting.
- **[Architecture](/essentials/architecture)** — Understand how error recovery fits into system design.
