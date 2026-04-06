---
title: Error Bus
description: Structured, non-fatal error reporting across the engine.
---

# Error Bus

GWEN's error bus provides a structured way for the engine, plugins, and game code to emit and handle errors gracefully. Instead of throwing exceptions (which halt the game), errors are emitted as events that your code can listen to and respond to—keeping the game running even when something goes wrong.

## The Basics

Access the error bus through the engine:

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

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
  if (event.code === 'PHYSICS:INVALID_SHAPE') {
    // Handle invalid physics shapes specifically
    rebuildPhysicsWorld()
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
CoreErrorCodes.PLUGIN_NOT_FOUND     // Plugin requested but not registered
CoreErrorCodes.WASM_LOAD_ERROR      // WASM module failed to load
CoreErrorCodes.CONTEXT_ERROR        // useX() called outside valid context
```

Plugins define their own error codes following the same pattern: `'PLUGIN_NAME:ERROR_TYPE'`.

## Emitting Errors

Plugins and game code can emit structured errors instead of throwing:

```ts
import { defineSystem, useEngine } from '@gwenjs/core'

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

### Graceful Physics Failure Recovery

Physics is computationally expensive and can fail. Instead of crashing, emit and recover:

```ts
import { usePhysics2D, useEngine } from '@gwenjs/core'

export const PhysicsSystem = defineSystem(() => {
  const physics = usePhysics2D()
  const engine = useEngine()

  onUpdate(() => {
    try {
      physics.step(dt)
    } catch (err) {
      engine.errors.emit({
        level: 'error',
        code: 'PHYSICS:STEP_FAILED',
        message: 'Physics step exceeded CPU budget',
        source: 'game:physics',
        error: err,
        context: { dt, bodyCount: physics.bodyCount() }
      })

      // Attempt recovery: reduce simulation quality
      physics.setSubsteps(1)
    }
  })
})
```

### Error Telemetry

Forward errors to your analytics backend:

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

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
- **`info`** — Informational events (e.g., "Physics initialized with 42 bodies")
- **`warning`** — Something unexpected but recoverable
- **`error`** — A problem that needs attention
- **`fatal`** — The engine cannot continue; recovery required

### Fatal Error Handler

Register a callback that runs before a fatal error is thrown:

```ts
engine.errors.onFatal(() => {
  // Cleanup: save game state, disconnect from server, etc.
  saveGameState()
  disconnectNetwork()
})
```

This runs synchronously, before the error handler is invoked.

### Installation

GWEN can install global error handlers:

```ts
engine.errors.install?.()
```

This attaches handlers to `window.onerror` and `unhandledrejection` events, forwarding uncaught errors to the error bus.

## API Summary

| Method | Description |
|---|---|
| `engine.errors.emit(event)` | Emit a structured error event |
| `engine.errors.on(handler)` | Register an error listener callback |
| `engine.errors.onFatal(cb)` | Run cleanup before a fatal error |
| `engine.errors.install?.()` | Install global error handlers |

## Next Steps

- **[Debug Mode](/advanced/debug-mode)** — View and filter errors in the debug overlay.
- **[Logging](/advanced/debug-mode)** — Use structured logging alongside error reporting.
- **[Architecture](/essentials/architecture)** — Understand how error recovery fits into system design.
