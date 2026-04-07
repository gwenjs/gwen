---
title: Hooks & Events
description: Subscribe to engine lifecycle events and game events with automatic cleanup.
---

# Hooks & Events

Hooks are a way to react to specific moments in your game's lifetime—when the engine starts, when an entity spawns, when a custom game event fires. Any part of your code can subscribe to these moments without tight coupling, and subscriptions automatically clean up when your actor or system ends.

## Why Hooks?

Systems process data each frame. But sometimes you need to react to a *specific moment* rather than checking a condition every tick. Did an entity just spawn? Did the player lose? Did a plugin register?

Hooks decouple these reactions. Instead of hardcoding "when the game starts, do X," you declare "I want to listen for engine:start and do X"—and if the listener gets removed, the subscription disappears automatically. No manual cleanup. No dangling references.

## useHook()

The primary API is `useHook()`. Call it inside an active engine context to subscribe to an event:

```typescript
import { useHook } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const LoggingSystem = defineSystem(function LoggingSystem() {
  useHook('engine:start', () => {
    console.log('Game started!')
  })

  useHook('entity:spawn', (id) => {
    console.log('Entity spawned:', id)
  })
})
```

The handler receives arguments matching the event signature. For `entity:spawn`, the entity ID. For `engine:tick`, the delta time.

### Auto-Cleanup

When you call `useHook()` inside a lifecycle context—an actor factory, a system, or a plugin setup—the subscription is automatically removed when the context ends. No unsubscribe calls needed.

In an **actor**:

```typescript
import { defineActor, useHook } from '@gwenjs/core/actor'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  useHook('engine:tick', (dt) => {
    console.log('Frame:', dt)
  })

  // Automatically cleaned up when this actor is despawned
  return {}
})
```

In a **system**:

```typescript
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const TrackingSystem = defineSystem(function TrackingSystem() {
  useHook('entity:spawn', (id) => {
    console.log('New entity:', id)
  })

  // Automatically cleaned up when the engine stops
})
```

In a **plugin setup**:

```typescript
import { withCleanup } from '@gwenjs/core'

export const MyPlugin = {
  setup() {
    const [, dispose] = withCleanup(() => {
      useHook('engine:start', () => {
        console.log('Plugin setup complete')
      })
      return {}
    })
    // dispose() called when plugin tears down
  }
}
```

Or from `engine.run()`:

```typescript
engine.run(() => {
  useHook('engine:tick', (dt) => {
    console.log('Running...')
  })
})
```

### Manual Unsubscribe

`useHook()` returns an unsubscribe function. Call it to remove the listener early, before the context ends:

```typescript
const unsubscribe = useHook('engine:tick', (dt) => {
  if (someCondition) {
    console.log('Stopping listener')
    unsubscribe() // Remove now, don't wait for context cleanup
  }
})
```

## Runtime Hooks Reference

These are the engine lifecycle events you can subscribe to. All fire automatically; you just listen.

| Event | Signature | Fires when |
|---|---|---|
| `engine:init` | `() => void` | Engine setup completes, before the RAF loop starts |
| `engine:start` | `() => void` | `engine.start()` called; RAF loop begins |
| `engine:stop` | `() => void` | `engine.stop()` called; cleanup begins |
| `engine:tick` | `(dt: number) => void` | Each frame begins (dt in milliseconds) |
| `engine:afterTick` | `(dt: number) => void` | Each frame completes (after render phase) |
| `engine:error` | `(payload: EngineErrorPayload) => void` | Frame loop catches an unhandled error |
| `entity:spawn` | `(id: EntityId) => void` | Entity created |
| `entity:destroy` | `(id: EntityId) => void` | Entity removed |
| `plugin:registered` | `(pluginName: string) => void` | Plugin setup completes and registers |
| `plugin:error` | `(payload: PluginErrorPayload) => void` | Plugin lifecycle hook throws and isn't recovered |
| `prefab:instantiate` | `(entityId: EntityId, extensions: GwenPrefabExtensions) => void` | Entity created from a prefab (used internally by plugins like Physics2D) |

## onCleanup()

`useHook()` uses `onCleanup()` under the hood. `onCleanup()` is the underlying primitive for any cleanup logic—not just hooks.

Use `onCleanup()` to register a cleanup callback that fires when the current lifecycle context ends:

```typescript
import { onCleanup } from '@gwenjs/core'
import { defineActor } from '@gwenjs/core/actor'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const timer = setInterval(() => {
    console.log('Tick')
  }, 1000)

  onCleanup(() => {
    clearInterval(timer) // Called when actor despawns
  })

  return {}
})
```

Write reusable composables by combining `onCleanup()` with other APIs:

```typescript
import { onCleanup } from '@gwenjs/core'

// Custom auto-cleanup composable
function useWindowResize(fn: (e: UIEvent) => void) {
  window.addEventListener('resize', fn)
  onCleanup(() => window.removeEventListener('resize', fn))
}

// Works in any lifecycle context
import { defineActor } from '@gwenjs/core/actor'

const MyActor = defineActor(MyPrefab, () => {
  useWindowResize((e) => {
    console.log('Window resized to', e)
  })

  // Auto-removed when the actor despawns
  return {}
})
```

## Custom Game Events

Declare your game's events in one place. Define them with `defineEvents()`, augment `GwenRuntimeHooks` via TypeScript declaration merging, and enjoy full type safety everywhere you emit or listen.

### Defining Events

Create a shared file with your custom event types:

```typescript
// src/events.ts
import { defineEvents } from '@gwenjs/core/actor'
import type { InferEvents } from '@gwenjs/core/actor'

export const GameEvents = defineEvents({
  'enemy:hit': (damage: number) => {},
  'enemy:die': (entityId: bigint) => {},
  'player:score': (points: number) => {},
})

// Augment GwenRuntimeHooks for type safety across the project
declare module '@gwenjs/core' {
  interface GwenRuntimeHooks extends InferEvents<typeof GameEvents> {}
}
```

`defineEvents()` is a declaration tool—it doesn't execute any code at runtime. Its value is the TypeScript signature. Pair it with `InferEvents` to fold your custom events into `GwenRuntimeHooks`.

### Emitting Events

Call `emit()` from inside an actor or system to fire an event:

```typescript
import { defineActor, emit } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  return {
    takeDamage: (damage: number) => {
      hp -= damage
      emit('enemy:hit', damage)
      if (hp <= 0) {
        emit('enemy:die', BigInt(Date.now()))
      }
    },
  }
})
```

### Listening to Events

Listen from an actor with `onEvent()`:

```typescript
import { defineActor, onEvent } from '@gwenjs/core/actor'
import { HUDPrefab } from '../prefabs'

export const HUDActor = defineActor(HUDPrefab, () => {
  let hits = 0

  onEvent('enemy:hit', (damage) => {
    hits++
    console.log(`Hit for ${damage} (total: ${hits})`)
  })

  onEvent('enemy:die', (id) => {
    console.log('Enemy eliminated')
  })

  // Automatically cleaned up when the actor despawns
  return {}
})
```

Listen from a system with `useHook()`:

```typescript
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(function ScoreSystem() {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
    console.log('Score:', score)
  })

  useHook('enemy:hit', (damage) => {
    score += damage
  })

  // Automatically cleaned up when the engine stops
})
```

::: tip Naming Convention
Prefix event names with a namespace to avoid collisions with built-in engine hooks:

- ✅ `'enemy:hit'`, `'player:die'`, `'ui:open'`
- ❌ `'hit'`, `'die'`, `'open'`

Built-in hooks use the `engine:` and `entity:` prefixes, so anything else is safe, but namespacing makes intent clear.
:::

## Build Hooks

Build hooks fire during the build/dev server startup in Node.js environments. They're used by modules to integrate with the Vite config or perform setup before the game loads.

**Build hooks are Node.js only** — they don't fire in the browser.

| Event | Fires when |
|---|---|
| `build:before` | Before any module setup runs |
| `build:done` | All modules have setup; build is complete |
| `module:before` | A single module's setup is about to run |
| `module:done` | A single module's setup completes |
| `vite:extendConfig` | A module extends the Vite config |

Use them in `gwen.config.ts`:

```typescript
// gwen.config.ts
import { defineGwenConfig } from '@gwenjs/app'

export default defineGwenConfig({
  hooks: {
    'build:before': () => {
      console.log('Build starting')
    },
    'build:done': () => {
      console.log('Build complete')
    },
  }
})
```

Or subscribe from a module's `setup()`:

```typescript
import { defineGwenModule } from '@gwenjs/kit'

export default defineGwenModule({
  meta: { name: 'my-module' },
  setup(_opts, gwen) {
    gwen.hook('build:done', () => {
      console.log('Module initialized')
    })
  }
})
```

## onEvent() vs useHook()

Both listen to events, but they're optimized for different contexts:

| | `onEvent()` | `useHook()` |
|---|---|---|
| **Context** | Actor factory only | Actor, system, plugin setup, `engine.run()` |
| **Auto-cleanup** | ✅ On actor despawn | ✅ On context end |
| **Import** | `@gwenjs/core/actor` | `@gwenjs/core` |
| **Use case** | Actor-local event subscriptions | Cross-cutting subscriptions from systems |
| **Shorthand?** | Yes, actor-specific | No, universal |

Use `onEvent()` inside actors for brevity. Use `useHook()` everywhere else, or when you need to listen from a system.

## API Summary

| Symbol | Description |
|---|---|
| `useHook(event, handler)` | Subscribe to an engine or custom event (auto-cleanup) |
| `onCleanup(fn)` | Register a cleanup callback in the active lifecycle context |
| `defineEvents(map)` | Declare a typed event contract (returns the same object at runtime) |
| `InferEvents<T>` | Type helper to extract event signatures from a map returned by `defineEvents()` |
| `emit(event, ...args)` | Fire an event from inside an actor or system |
| `onEvent(event, handler)` | Listen to an event inside an actor (shorthand for `useHook()`) |
| `GwenRuntimeHooks` | The interface of all engine lifecycle events (extended by plugins and custom events via declaration merging) |
