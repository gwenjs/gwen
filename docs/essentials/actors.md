---
title: Actors
description: Composable, instance-based game objects with their own entity and lifecycle.
---

# Actors

An **actor** is a composable, instance-based game object. Each instance owns a single ECS entity and runs its own lifecycle hooks. Actors are defined with `defineActor()` and declared in scenes via `useActor()`.

::: info Auto-imports
`defineActor`, `definePrefab`, `onStart`, `onDestroy`, `onEnable`, `onDisable`, `useActor`, `useTransform`, `useComponent`, `useEntityId`, `usePrefab` are all auto-imported. `onRelease` and `onReset` are **not** auto-imported — import them from `@gwenjs/core/actor`. `useHook` and `emit` are **not** auto-imported — import them from `@gwenjs/core`.
:::

## The Basics

`defineActor(prefab, factory)` takes a prefab (component layout) and a factory that sets up lifecycle hooks:

```ts
import { defineActor, onStart, onDestroy } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  onStart(() => {
    console.log('spawned')
  })

  onDestroy(() => {
    console.log('destroyed')
  })
})
```

## Declaring in a Scene

Declare the actor in a scene using `useActor()` — this registers it and returns a handle:

```ts
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { useActor } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  const enemy = useActor(EnemyActor)

  onEnter(() => enemy.spawn({ hp: 100 }))
  onExit(() => enemy.despawnAll())
})
```

## ActorHandle API

`useActor()` returns an `ActorHandle` combined with the actor's public API:

| Method | Description |
|---|---|
| `spawn(props?)` | Create an instance, returns entity ID (`bigint`) |
| `spawnOnce(props?)` | Spawn only if no live instance exists yet |
| `despawn(id)` | Remove a specific instance |
| `despawnAll()` | Remove all live instances |
| `count()` | Number of live instances |
| `get()` | Public API of the first live instance (`undefined` if none) |
| `getAll()` | Public APIs of every live instance |

## Props

Pass typed data when spawning:

```ts
export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number; speed: number }) => {
  let hp = props.hp
  let speed = props.speed

  // ...
})

// In the scene:
enemy.spawn({ hp: 50, speed: 2 })
```

## Public API

Return an object from the factory to expose methods on the handle:

```ts
export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  return {
    takeDamage: (n: number) => { hp -= n },
    getHp: () => hp,
  }
})

// In a system or scene:
const enemy = useActor(EnemyActor)
enemy.get()?.takeDamage(10)     // first live instance
for (const e of enemy.getAll()) e.takeDamage(5)  // all instances
```

## Frame Hooks

Actors support the same frame phases as systems:

```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  onBeforeUpdate((dt) => { /* read input */ })
  onUpdate((dt)       => { /* apply movement */ })
  onAfterUpdate((dt)  => { /* post-process */ })
  onRender(()         => { /* draw */ })
})
```

## Reading Component Data

Use `useComponent(def)` to get a reactive proxy for a component's fields on this actor instance:

```ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core/actor'
import { Health, Velocity } from './components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)
  const velocity = useComponent(Velocity)

  onUpdate((dt) => {
    if (health.current <= 0) {
      // handle death
    }

    // Single field write
    velocity.x += 1

    // Batch write — more efficient for multiple fields
    health.$set({ current: 80, max: 100 })
  })
})
```

`$set(values)` writes all specified fields in a single operation — more efficient than writing fields one by one when updating multiple values.

## Transform

Use `useTransform()` to read and write the actor's spatial transform:

```ts
import { defineActor, useTransform, onStart, onUpdate } from '@gwenjs/core/actor'

export const PlayerActor = defineActor(PlayerPrefab, (props: { x: number; y: number }) => {
  const transform = useTransform()

  onStart(() => {
    transform.setPosition(props.x, props.y)
  })

  onUpdate((dt) => {
    transform.translate(vx * dt, vy * dt)
    console.log(transform.world.x, transform.world.y)
  })
})
```

**Write methods** — update local transform immediately:

| Method | Description |
|---|---|
| `translate(dx, dy)` | Move by delta |
| `setPosition(x, y)` | Set local position |
| `rotateTo(angle)` | Set local rotation (radians) |
| `rotate(delta)` | Add delta to local rotation |
| `scaleTo(sx, sy?)` | Set local scale (`sy` defaults to `sx`) |

**Read properties** — world values, updated once per frame:

| Property | Description |
|---|---|
| `world.x`, `world.y` | World position |
| `world.rotation` | World rotation (radians) |
| `world.scaleX`, `world.scaleY` | World scale |
| `hasParent` | `true` if attached to a parent |

**Hierarchy:**

| Method | Description |
|---|---|
| `setParent(handleOrId, keepWorldPos?)` | Attach to a parent entity |
| `detach(keepWorldPos?)` | Detach from parent |

::: info World reads are one frame behind
`world.x/y` reflects state from the **previous frame**. Writes made in `onUpdate` are visible on the next frame.
:::

## Entity ID

Use `useEntityId()` to get the stable `bigint` ID of this actor instance:

```ts
import { defineActor, useEntityId, onUpdate } from '@gwenjs/core/actor'
import { Position } from './components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const entityId = useEntityId()

  onUpdate((dt) => {
    // Direct SoA access — fastest path
    Position.x[entityId] += Velocity.x[entityId] * dt
  })
})
```

::: info Setup-time only
`useEntityId()` must be called during the synchronous factory body, not inside a callback.
:::

## Listening to Events

Use `useHook(name, fn)` to subscribe to engine or game events. The subscription is automatically removed when the actor is despawned. If the actor is pool-dormant, the handler is silenced (not removed).

```ts
import { defineActor, onStart } from '@gwenjs/core/actor'
import { useHook } from '@gwenjs/core'

export const HUDActor = defineActor(HUDPrefab, () => {
  useHook('enemy:die', () => {
    console.log('enemy killed')
  })

  useHook('score:add', (points: number) => {
    updateScoreDisplay(points)
  })
})
```

## Emitting Events

Use `emit(name, ...args)` to fire events from an actor. All registered handlers run synchronously before `emit` returns.

```ts
import { defineActor, useComponent } from '@gwenjs/core/actor'
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

## Accessing Services

Use `useService(key)` to access a value provided by a plugin:

```ts
import { defineActor, onStart } from '@gwenjs/core/actor'
import { useService } from '@gwenjs/core/system'

export const AudioActor = defineActor(AudioPrefab, () => {
  const audio = useService('audio')

  onStart(() => {
    audio.play('spawn')
  })
})
```

## Pool Lifecycle Hooks

These hooks are only relevant when using `defineActorPool`. They manage the dormancy cycle of pool-managed actors.

```ts
import { defineActor, onStart, onDestroy } from '@gwenjs/core/actor'
import { onRelease, onReset } from '@gwenjs/core/actor'
import { onEnable, onDisable } from '@gwenjs/core'

export const BulletActor = defineActor(BulletPrefab, () => {
  onStart(() => { /* first spawn only */ })

  onReset((props) => {
    // Called with new props when re-acquired from pool
    // Reset component data here
  })

  onEnable(() => {
    // Called after onReset — actor is now active
  })

  onDisable(() => {
    // Called when released to pool — actor goes dormant
  })

  onRelease(() => {
    // Called after onDisable — clean up physics, audio, tweens
  })

  onDestroy(() => { /* pool destroyed entirely */ })
})
```

| Hook | When |
|---|---|
| `onStart` | First spawn only |
| `onReset(props)` | When re-acquired from pool — reset component data here |
| `onEnable` | After `onReset` — actor is active |
| `onDisable` | When released to pool — actor goes dormant |
| `onRelease` | After `onDisable` — clean up external state |
| `onDestroy` | Pool is destroyed entirely |

::: info Import paths for pool hooks
`onRelease` and `onReset` are from `@gwenjs/core/actor` but are **not** auto-imported — add them explicitly. `onEnable` and `onDisable` are from `@gwenjs/core`, also not auto-imported.
:::

## Async Composables

Composable handles (`useTransform()`, `useComponent()`, etc.) must be called during the **synchronous factory phase** — not inside async callbacks after `await`. Capture them during setup and use them as closures:

```ts
const PlayerActor = defineActor(PlayerPrefab, () => {
  const transform = useTransform()  // ✅ captured synchronously

  onStart(async () => {
    await loadPlayerSprite()
    transform.setPosition(400, 300)  // ✅ closure — no context needed
  })
})
```

::: warning Not valid in actors
- ❌ `useSceneRouter` — actors don't navigate. Use `emit` to signal intent; handle navigation in a system.
- ❌ `useWasmModule` — plugin-level API, not for game code.
:::

## Actors vs Systems

| | Actor | System |
|---|---|---|
| **Scope** | Per-instance | Global |
| **Entity** | Owns one entity | Queries many entities |
| **Use case** | Named game objects (player, boss, HUD) | Batch logic (movement, AI, collision) |
| **State** | Local to instance | Global or per-query |

## API Summary

| | |
|---|---|
| `defineActor(prefab, factory)` | Declare an actor type |
| `useActor(def)` | Get typed handle (in scene, system, or actor setup) |
| `handle.spawn(props?)` | Spawn an instance |
| `handle.spawnOnce(props?)` | Spawn singleton (noop if already live) |
| `handle.despawn(id)` | Despawn a specific instance |
| `handle.despawnAll()` | Despawn all live instances |
| `handle.count()` | Number of live instances |
| `handle.get()` | Public API of first live instance |
| `handle.getAll()` | Public APIs of all live instances |
| `useEntityId()` | Stable `bigint` ID for this instance (setup-time) |
| `useComponent(def)` | Reactive component proxy — read/write fields, `$set` for batch |
| `useTransform()` | Spatial transform handle |
| `useService(key)` | Access a plugin-provided service |
| `useHook(name, fn)` | Subscribe to an event (import from `@gwenjs/core`) |
| `emit(name, ...args)` | Fire an event (import from `@gwenjs/core`) |
| `onStart(fn)` | Runs once at first spawn |
| `onDestroy(fn)` | Runs at despawn |
| `onEnable(fn)` | Pool: after re-acquiring (import from `@gwenjs/core`) |
| `onDisable(fn)` | Pool: before releasing (import from `@gwenjs/core`) |
| `onReset(fn)` | Pool: called with new props (import from `@gwenjs/core/actor`) |
| `onRelease(fn)` | Pool: clean up external state (import from `@gwenjs/core/actor`) |

## Next Steps

- **[Prefabs](/essentials/prefabs)** — Define the component layout for actors.
- **[Scenes](/essentials/scenes)** — Declare and control actors from a scene.
- **[Hooks](/essentials/hooks)** — Define custom typed events.
- **[Systems](/essentials/systems)** — Implement batch logic that runs across many entities.
