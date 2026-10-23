---
title: Hooks & Events
description: Subscribe to engine lifecycle events and game events with automatic cleanup.
---

# Hooks & Events

Hooks are a way to react to specific moments in your game's lifetime—when the engine starts, when an entity is destroyed, when a custom game event fires. Any part of your code can subscribe to these moments without tight coupling, and subscriptions automatically clean up when your actor or system ends.

## Why Hooks?

Systems process data each frame. But sometimes you need to react to a *specific moment* rather than checking a condition every tick. Did an entity just get destroyed? Did the player lose? Did a plugin register?

Hooks decouple these reactions. Instead of hardcoding "when the game starts, do X," you declare "I want to listen for engine:start and do X"—and if the listener gets removed, the subscription disappears automatically. No manual cleanup. No dangling references.

## useHook()

The primary API is `useHook()`. Call it inside an active engine context to subscribe to an event:

```typescript
import { useHook } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const LoggingSystem = defineSystem(() => {
  useHook('engine:start', () => {
    console.log('Game started!')
  })

  useHook('entity:destroy', (id) => {
    console.log('Entity destroyed:', id)
  })
})
```

The handler receives arguments matching the event signature. For `entity:destroy`, the entity ID. For `engine:tick`, the delta time in seconds.

### Auto-Cleanup

When you call `useHook()` inside a lifecycle context—an actor factory, a system, or a plugin setup—the subscription is automatically removed when the context ends. No unsubscribe calls needed.

In an **actor**:

```typescript
import { defineActor } from '@gwenjs/core/actor'
import { useHook } from '@gwenjs/core'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  useHook('engine:tick', (dt) => {
    console.log('Frame:', dt)
  })

  // Automatically cleaned up when this actor is despawned
  return {}
})
```

::: info useHook inside a pooled actor
`useHook()` inside an actor handles pool dormancy automatically — the handler is silenced while the actor is dormant and resumes when it is re-enabled. No extra API is needed.
:::

In a **system**:

```typescript
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const TrackingSystem = defineSystem(() => {
  useHook('entity:destroy', (id) => {
    console.log('Destroyed entity:', id)
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
| `engine:state-change` | `(payload: { from, to, reason }) => void` | Once per real lifecycle transition |
| `engine:tick` | `(dt: number) => void` | Each frame begins. `dt` is in seconds |
| `engine:before-update` | `(dt: number) => void` | Before physics |
| `engine:update` | `(dt: number) => void` | Main update phase |
| `engine:after-update` | `(dt: number) => void` | After the update phase |
| `engine:render` | `(alpha: number) => void` | Once per display frame |
| `engine:afterTick` | `(dt: number) => void` | After each simulation step. After render when `physicsHz` is 0. Before the display render in fixed mode. |
| `engine:memory-grow` | `(info: { epoch, byteLength, frame }) => void` | Linear memory grew, before the next phase |
| `engine:error` | `(payload: EngineErrorPayload) => void` | Frame loop catches an unhandled error |
| `entity:destroy` | `(id: EntityId) => void` | `destroyEntity` removed that id |
| `plugin:registered` | `(pluginName: string) => void` | Plugin setup completes and registers |
| `plugin:error` | `(payload: PluginErrorEvent) => void` | Plugin lifecycle hook throws and isn't recovered |
| `prefab:instantiate` | `(entityId: EntityId, extensions: GwenPrefabExtensions) => void` | Entity created from a prefab (used internally by plugins like Physics2D). Augment `GwenPrefabExtensions` with `declare module "@gwenjs/schema"`. |

With `physicsHz` at 0, one `advance` runs `engine:tick`, `engine:before-update`, `engine:update`, `engine:after-update`, `engine:render`, then `engine:afterTick`.

```ts run
import assert from "node:assert/strict";

const order: string[] = [];
engine.hooks.hook("engine:tick", () => {
  order.push("tick");
});
engine.hooks.hook("engine:before-update", () => {
  order.push("before-update");
});
engine.hooks.hook("engine:update", () => {
  order.push("update");
});
engine.hooks.hook("engine:after-update", () => {
  order.push("after-update");
});
engine.hooks.hook("engine:render", () => {
  order.push("render");
});
engine.hooks.hook("engine:afterTick", () => {
  order.push("afterTick");
});
await engine.advance(1 / 60);
assert.equal(order.join(","), "tick,before-update,update,after-update,render,afterTick");
```

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

Declare your game's events in one place. Define them with `defineHooks()`, augment `GwenRuntimeHooks` via TypeScript declaration merging, and enjoy full type safety everywhere you emit or listen.

### Defining Events

Create a shared file with your custom event types:

```typescript
// src/hooks.ts
import { defineHooks } from '@gwenjs/core'
import type { InferHooks } from '@gwenjs/core'

export const GameHooks = defineHooks({
  'enemy:hit': (damage: number) => {},
  'enemy:die': (entityId: bigint) => {},
  'player:score': (points: number) => {},
})

// Augment GwenRuntimeHooks for type safety across the project
declare module '@gwenjs/core' {
  interface GwenRuntimeHooks extends InferHooks<typeof GameHooks> {}
}
```

`defineHooks()` is a declaration tool—it doesn't execute any code at runtime. Its value is the TypeScript signature. Pair it with `InferHooks` to fold your custom events into `GwenRuntimeHooks`.

### Emitting Events

Call `emit()` from inside an actor or system to fire an event:

```typescript
import { emit } from '@gwenjs/core'
import { defineActor } from '@gwenjs/core/actor'
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

Listen from an actor with `useHook()`:

```typescript
import { useHook } from '@gwenjs/core'
import { HUDPrefab } from '../prefabs'

export const HUDActor = defineActor(HUDPrefab, () => {
  let hits = 0

  useHook('enemy:hit', (damage) => {
    hits++
    console.log(`Hit for ${damage} (total: ${hits})`)
  })

  useHook('enemy:die', (id) => {
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

export const ScoreSystem = defineSystem(() => {
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
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
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
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: { name: 'my-module' },
  setup(_opts, gwen) {
    gwen.hook('build:done', () => {
      console.log('Module initialized')
    })
  }
})
```

## API Summary

| Symbol | Description |
|---|---|
| `useHook(event, handler)` | Subscribe to an engine or custom event (auto-cleanup on context end; silenced while pool-dormant) |
| `onCleanup(fn)` | Register a cleanup callback in the active lifecycle context |
| `defineHooks(map)` | Declare a typed event contract (returns the same object at runtime) |
| `InferHooks<T>` | Type helper to extract event signatures from a map returned by `defineHooks()` |
| `emit(event, ...args)` | Fire an event from inside an actor or system |
| `GwenRuntimeHooks` | The interface of all engine lifecycle events (extended by plugins and custom events via declaration merging) |
