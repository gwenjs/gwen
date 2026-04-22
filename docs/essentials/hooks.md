---
title: Hooks
description: Communicate across actors and systems with typed events using useHook, emit, and defineHooks.
---

# Hooks

GWEN's hook system lets any part of your game listen to and fire typed events — without direct references between actors, systems, and plugins. It's the primary communication channel for decoupled game code.

::: info Imports
In a GWEN project, `defineHooks` is auto-imported. Only `useHook` and `emit` require an explicit import:
```ts
import { useHook, emit } from '@gwenjs/core'
```
:::

## Listening to Events

Use `useHook(name, fn)` inside a system, actor, or scene factory to subscribe to an event. The subscription is cleaned up automatically when the context ends.

```ts
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(() => {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
    console.log('Score:', score)
  })
})
```

`useHook` returns an unsubscribe function you can call early if needed:

```ts
const stop = useHook('player:died', () => { ... })
// Later:
stop()
```

## Emitting Events

Use `emit(name, ...args)` to fire an event from any engine context. All registered handlers run synchronously before `emit` returns.

```ts
import { emit } from '@gwenjs/core'
import { Health } from './components'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const health = useComponent(Health)

  return {
    takeDamage: (n: number) => {
      health.current -= n
      emit('enemy:hit', n)
      if (health.current <= 0) emit('enemy:die')
    },
  }
})
```

## Defining Custom Hooks

Use `defineHooks()` to declare typed contracts for your game events. This gives you full TypeScript autocomplete on event names and argument types across the entire project.

```ts
// src/hooks.ts
export const GameHooks = defineHooks({
  'enemy:die':  (): void => undefined,
  'enemy:hit':  (_damage: number): void => undefined,
  'score:add':  (_points: number): void => undefined,
  'player:die': (): void => undefined,
})
```

`defineHooks` is an identity function — its only purpose is to let TypeScript infer the event map. The value is its type signature.

## Augmenting GwenRuntimeHooks

To get full type safety on `useHook` and `emit` project-wide, augment `GwenRuntimeHooks` in `@gwenjs/schema`:

```ts
// src/hooks.ts
import type { InferHooks } from '@gwenjs/core'

export const GameHooks = defineHooks({
  'enemy:die':  (): void => undefined,
  'enemy:hit':  (_damage: number): void => undefined,
  'score:add':  (_points: number): void => undefined,
})

declare module '@gwenjs/schema' {
  interface GwenRuntimeHooks extends InferHooks<typeof GameHooks> {}
}
```

After this, `useHook('enemy:die', () => {})` and `emit('enemy:hit', 50)` are fully typed — wrong event names or argument types are caught at compile time.

::: warning Use `@gwenjs/schema`, not `@gwenjs/app`
The interface to augment is `GwenRuntimeHooks` in `@gwenjs/schema`. Augmenting `@gwenjs/app` has no effect.
:::

## Auto-Cleanup

Cleanup is automatic and depends on context:

| Context | When handler is removed |
|---|---|
| Inside `defineSystem` | When the scene exits |
| Inside `defineActor` | When the actor is despawned |
| Inside `defineScene` | When the scene exits |
| Pool-dormant actor | Handler is silenced (not removed) until re-enabled |
| Plugin `setup()` | Manual — save the returned unsubscribe fn and call it in `engine:stop` |

## Naming Convention

Prefix event names with a namespace:

```ts
'enemy:hit'       // ✅ namespaced
'score:add'       // ✅ namespaced
'hit'             // ❌ too generic — may collide
```

The namespaces `engine:*`, `entity:*`, `scene:*`, `actor:*`, and `plugin:*` are reserved for built-in framework events.

## Built-in Events

| Event | Args | When |
|---|---|---|
| `engine:init` | — | Once, after all plugins set up |
| `engine:start` | — | Once, when frame loop begins |
| `engine:stop` | — | Once, on engine teardown |
| `engine:tick` | `dt: number` | Every frame start |
| `engine:afterTick` | `dt: number` | Every frame end |
| `engine:before-update` | `dt: number` | Before physics |
| `engine:update` | `dt: number` | Main update phase |
| `engine:after-update` | `dt: number` | After update phase |
| `engine:render` | — | Render phase |
| `entity:spawn` | `id: EntityId` | Entity created |
| `entity:destroy` | `id: EntityId` | Entity destroyed |
| `scene:enter` | `name, params?` | Scene activated |
| `scene:beforeLeave` | `name` | Before scene deactivation |
| `scene:leave` | `name` | Scene deactivated |
| `scene:transition:leave` | `{ from, to }` | Before leave animation |
| `scene:transition:enter` | `{ from, to }` | After enter animation |
| `actor:enable` | `entityId` | Actor scope resumed |
| `actor:disable` | `entityId` | Actor scope paused |
| `engine:error` | `EngineErrorPayload` | Unhandled frame error |

## API Summary

| | |
|---|---|
| `useHook(name, fn)` | Subscribe to an event; returns unsubscribe fn |
| `emit(name, ...args)` | Fire an event synchronously |
| `defineHooks(map)` | Declare a typed event contract |
| `InferHooks<T>` | Map `defineHooks` result to `GwenRuntimeHooks` shape |

## Next Steps

- **[Systems](/essentials/systems)** — Use `useHook` in a system context.
- **[Actors](/essentials/actors)** — Use `useHook` and `emit` inside actors.
- **[Advanced Hooks](/advanced/hooks)** — Deep dive: hook internals, priorities, async hooks.
