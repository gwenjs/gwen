---
title: Actor Pool
description: Reuse actor instances instead of destroying them to reduce GC pressure and allocation costs.
---

# Actor Pool

In most games, some actors are created and destroyed very frequently: enemies, projectiles,
particles, hit effects. Allocating a new ECS entity for each spawn creates GC pressure and
unpredictable frame hitches. **Actor pooling** solves this by reusing a fixed set of entities
instead of destroying and recreating them.

## The Problem

Each `spawn()` call allocates an `ActorInstance` in memory, adds components to the ECS,
and executes the factory function. When `despawn()` is called, the entity is destroyed and
all state is freed. For high-frequency actors, this constant alloc/free cycle wastes CPU and
stresses the garbage collector.

```ts
// ❌ Every shot allocates a new entity — constant GC pressure
const bullets = useActor(BulletActor)

onUpdate(() => {
  if (shooting) {
    const id = bullets.spawn({ speed: 800 })
    // bullets.despawn(id) later — back to square one every frame
  }
})
```

## The Solution: `defineActorPool`

A pool keeps a fixed number of entities alive. When you "despawn" one, it becomes **dormant**
instead of being destroyed. The next `acquire()` call reuses a dormant slot. After warm-up,
that reuse keeps the entity. It still allocates. `useQuery` skips dormant pooled entities.

```ts
// pools/BulletPool.ts
import { defineActorPool } from '@gwenjs/core/actor'
import { BulletActor } from '../actors/BulletActor'

export const BulletPool = defineActorPool(BulletActor, { size: 200 })
```

## Scene Integration

Call `useActorPool()` inside a `defineScene` factory. It installs the pool into the scene,
registers cleanup on exit, and **returns the pool** so you can pass it to the systems and
actors that need it.

```ts
import { defineScene, onEnter, useSystem } from '@gwenjs/core/scene'
import { useActor, useActorPool } from '@gwenjs/core/actor'
import { BulletPool } from '../pools/BulletPool'
import { ShootingSystem } from '../systems/ShootingSystem'
import { PlayerActor } from '../actors/PlayerActor'

export const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const bulletPool = useActorPool(BulletPool)

  useSystem(ShootingSystem(bulletPool))

  onEnter(() => {
    player.spawnOnce()
    // bulletPool.acquire() is ready here — all plugins are installed
  })
  // bulletPool.destroyAll() is called automatically when the scene exits
})
```

::: tip Pools are scene-scoped by design
`useActorPool()` is the only correct way to use a pool. Do not import the `defineActorPool`
value and call `.acquire()` on it directly from systems or actors — pass the handle returned
by `useActorPool()` instead. This keeps plugin registration, lifecycle, and teardown under
scene control.
:::

## Passing the Pool to Systems

Systems that need to spawn or release pooled actors receive the pool via dependency injection —
the standard `defineSystem` parameter pattern:

```ts
// systems/ShootingSystem.ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import type { ActorPool } from '@gwenjs/core/actor'
import type { BulletProps } from '../actors/BulletActor'

export const ShootingSystem = defineSystem(
  'ShootingSystem',
  (bulletPool: ActorPool<BulletProps, void>) => {
    onUpdate(() => {
      if (triggerPressed) {
        try {
          bulletPool.acquire({ speed: 800, x: player.x, y: player.y })
        } catch {
          // Pool exhausted — skip this shot
        }
      }
    })
  },
)
```

```ts
// GameScene.ts
const bulletPool = useActorPool(BulletPool)
useSystem(ShootingSystem(bulletPool))  // pool injected as argument
```

## Passing the Pool to Actors via Props

When an actor needs to acquire from a pool (e.g. a manager actor that listens for events),
pass the pool as spawn props:

```ts
// actors/ShooterManager.ts
import { useHook } from '@gwenjs/core'
import type { ActorPool } from '@gwenjs/core/actor'
import type { BulletProps } from './BulletActor'

export const ShooterManagerActor = defineActor(
  ShooterManagerPrefab,
  (props: { bulletPool: ActorPool<BulletProps, void> }) => {
    useHook('player:shoot', (x, y) => {
      try {
        props.bulletPool.acquire({ x, y, speed: 800 })
      } catch {
        // Pool exhausted — shot skipped
      }
    })
    return {}
  },
)
```

```ts
// GameScene.ts
const manager = useActor(ShooterManagerActor)
const bulletPool = useActorPool(BulletPool)

onEnter(() => {
  manager.spawnOnce({ bulletPool })
})
```

## Actor Lifecycle with a Pool

Add `onRelease` and `onReset` alongside your existing lifecycle hooks:

```ts
import { defineActor, onStart, onUpdate, onDestroy, onRelease, onReset } from '@gwenjs/core/actor'

export const BulletActor = defineActor(BulletPrefab, (props: BulletProps) => {
  const id = useEntityId()

  onStart(() => {
    // Called once on first spawn — set up initial state
    Position.x[id] = props.x
    Velocity.vx[id] = props.speed * Math.cos(props.direction)
  })

  onRelease(() => {
    // Called when returned to the pool — clean up external state
    physics.removeBody(id)
    sounds.stop(id)
  })

  onReset((newProps: BulletProps) => {
    // Called on every reuse — reset to new props.
    // Component defaults, then prefab defaults, are already written into the existing components.
    // A prefab component removed during the previous life is not re-added.
    Position.x[id] = newProps.x
    Velocity.vx[id] = newProps.speed * Math.cos(newProps.direction)
    physics.addBody(id, { ... })
  })

  onDestroy(() => {
    // Called only when the pool itself is destroyed (destroyAll)
  })
})
```

| Hook | When called |
|---|---|
| `onStart` | First spawn only |
| `onRelease` | Every `pool.release(id)` |
| `onReset` | Every `pool.acquire(props)` on a reused slot |
| `onDestroy` | `pool.destroyAll()` or engine shutdown |

## Releasing from Within the Actor

An actor can release itself back to the pool by calling `pool.release()` — for example when
it moves off screen. Since `release()` is deferred to `engine:afterTick`, it is safe to call
from inside an `onUpdate` callback:

```ts
export const BulletActor = defineActor(BulletPrefab, (props: { pool: ActorPool<BulletProps, void> }) => {
  const id = useEntityId()

  onUpdate(() => {
    if (Position.y[id] < 0) {
      props.pool.release(id)
    }
  })
})
```

## Physics Integration

Physics engines like Rapier2D maintain their own internal simulation separate from the ECS.
A dormant actor's physics body **continues to simulate** unless you explicitly remove it.
Use `onRelease` and `onReset` to manage it:

```ts
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const physics = usePhysics2D()
  const id = useEntityId()

  onRelease(() => {
    physics.removeBody(id)  // remove from physics world
  })

  onReset((props: EnemyProps) => {
    Position.x[id] = props.x
    Position.y[id] = props.y
    physics.addBody(id, { type: 'dynamic' })  // re-enter physics world
  })
})
```

## Pool Stats and Monitoring

```ts
bulletPool.stats()
// {
//   size: 200,        — maximum capacity
//   active: 47,       — currently acquired
//   available: 153,   — dormant slots ready for reuse
//   peakActive: 91,   — historical peak (useful for sizing)
//   acquireCount: 842 — total acquires since pool creation
// }
```

`peakActive` is the most useful metric for calibrating `size`: run your game for a full
session, then set `size` to `peakActive + 20%` as a safety margin.

## Typing a Pool Parameter

Three levels of precision depending on what you need:

```ts
import type { ActorPool } from '@gwenjs/core/actor'

// Any pool — when the concrete props don't matter
function logStats(pool: ActorPool) {
  console.log(pool.stats())
}

// Typed pool — when you call acquire() with specific props
function spawnBullet(pool: ActorPool<BulletProps>) {
  pool.acquire({ speed: 800, x: 0, y: 0 })
}

// Exact pool — inferred from the definition, no generics to write
function spawnBullet(pool: typeof BulletPool) {
  pool.acquire({ speed: 800, x: 0, y: 0 })
}
```

`typeof BulletPool` is the most ergonomic when you're referring to one specific pool —
TypeScript infers `Props` and `PublicAPI` automatically from the `defineActorPool` call.
Use `ActorPool<Props>` when writing a utility that works with any pool of a given actor type.

## Observable Hooks

React to pool events from outside:

```ts
bulletPool.hooks.hook('pool:warn',     ({ ratio }) => console.warn('pool pressure', ratio))
bulletPool.hooks.hook('pool:critical', ({ active, size }) => spawnRateController.reduce())
bulletPool.hooks.hook('pool:acquire',  ({ id }) => analytics.track('bullet-spawn'))
bulletPool.hooks.hook('pool:release',  ({ id }) => analytics.track('bullet-release'))
```

| Hook | Fires when |
|---|---|
| `pool:acquire` | Just before a slot is returned to the caller |
| `pool:release` | After a slot is marked dormant |
| `pool:warn` | Active slots cross `warnThreshold` (default 80%) |
| `pool:critical` | Active slots cross `criticalThreshold` (default 95%) |
| `pool:exhausted` | All slots are active — immediately before the throw |

## Pool Exhaustion

When `acquire()` is called and all slots are active, it throws a `PoolExhaustedError`.
The engine logger also emits an `error`-level message. Wrap in a `try/catch` to handle
gracefully:

```ts
try {
  bulletPool.acquire({ speed: 800, x: player.x, y: player.y })
} catch (e) {
  if (e instanceof PoolExhaustedError) {
    // Pool is full — skip this spawn or queue it
  }
}
```

::: tip Sizing the pool
If exhaustion happens regularly, increase `size`. If `peakActive` in `stats()` is much
lower than `size`, shrink it. Frequent `pool:warn` events that don't resolve suggest a
`release()` call is missing somewhere.
:::

## Lazy Allocation

Entities are allocated on demand — the first `size` calls to `acquire()` each create a new
entity. Subsequent calls reuse dormant slots. This means:

- No startup cost: nothing is allocated until `acquire()` is called.
- First N spawns have full allocation cost (factory + ECS entity creation).
- All subsequent spawns after the pool is warmed up are near-zero cost.

If your game spawns a large burst of actors at the very start of a level, consider a manual
warm-up via a quick loop in `onEnter`:

```ts
onEnter(async () => {
  // Pre-fill the pool before gameplay starts to avoid hitches
  const ids = Array.from({ length: 50 }, () => bulletPool.acquire())
  for (const id of ids) bulletPool.release(id)
  await engine.advance(16) // flush the releases
})
```

## Scope

| Scope | Behaviour |
|---|---|
| `useActorPool(pool)` in a scene | `destroyAll()` on scene exit |
| `scope: 'global'` | `destroyAll()` on `engine:stop` |
| `scope: CustomScope` | `onMount` on install, `onUnmount` on engine stop |
| None (default) | Manual `destroyAll()` management |

## API Reference

| Export | From |
|---|---|
| `defineActorPool(actor, options)` | `@gwenjs/core/actor` |
| `useActorPool(pool)` → `ActorPool` | `@gwenjs/core/actor` |
| `onRelease(fn)` | `@gwenjs/core/actor` |
| `onReset(fn)` | `@gwenjs/core/actor` |
| `PoolExhaustedError` | `@gwenjs/core/actor` |
| `ActorPool<Props, PublicAPI>` | `@gwenjs/core/actor` |
| `ActorPoolDefinition<Props, PublicAPI>` | `@gwenjs/core/actor` |
| `PoolOptions` | `@gwenjs/core/actor` |
| `PoolStats` | `@gwenjs/core/actor` |
| `PoolHooks` | `@gwenjs/core/actor` |

## Manual Plugin Registration

::: info Automatic with Gwen
In a standard Gwen project, plugin installation is handled automatically — `useActorPool()`
registers the plugins in `ctx.systems` and the Vite bootstrap calls `engine.use()` on each
one. You don't write any of this yourself.
:::

If you're using the engine directly (custom setup, tests, or outside of a standard Gwen
project), register the pool plugin manually **after** the actor plugin:

```ts
// main.ts — only needed outside a standard Gwen project
await engine.use(BulletActor._plugin)  // actor first
await engine.use(BulletPool.plugin)    // then the pool
```

## Next Steps

- **[Actor Leak Detection](/advanced/actor-leak-detection)** — Detect actors that are never despawned or released.
- **[Actors](/essentials/actors)** — Actor lifecycle: spawn, despawn, and public API.
- **[Hooks & Events](/advanced/hooks)** — The engine hook system used by pool events.
