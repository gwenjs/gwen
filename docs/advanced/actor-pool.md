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
const bullets = useActor(BulletActor)  // captured in setup phase

onUpdate(() => {
  if (shooting) {
    const id = bullets.spawn({ speed: 800 })
    // bullets.despawn(id) later — back to square one every frame
  }
})
```

## The Solution: `defineActorPool`

A pool keeps a fixed number of entities alive. When you "despawn" one, it becomes **dormant**
instead of being destroyed. The next `acquire()` call reuses a dormant slot instantly, at
zero allocation cost.

```ts
import { defineActorPool, useActorPool } from '@gwenjs/core/actor'

export const BulletPool = defineActorPool(BulletActor, { size: 200 })
```

## Using the Pool

`acquire()` and `release()` are called from within actor or system lifecycle hooks:

```ts
// In the shooter actor — acquire on trigger press
const PlayerActor = defineActor(PlayerPrefab, () => {
  const id = useEntityId()

  onUpdate(() => {
    if (triggerPressed) {
      BulletPool.acquire({ speed: 800, x: Position.x[id], y: Position.y[id] })
    }
  })
})

// In the bullet actor — release when off screen
const BulletActor = defineActor(BulletPrefab, () => {
  const id = useEntityId()

  onUpdate(() => {
    if (Position.x[id] > screenWidth) {
      BulletPool.release(id)  // deferred to end of frame — safe to call mid-update
    }
  })
})
```

`acquire()` is synchronous and returns an `EntityId` like `spawn()` does.
`release()` is deferred to `engine:afterTick` to avoid mid-frame mutations.

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
    // Called on every reuse — reset to new props (prefab defaults already applied)
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

## Scene Integration

Use `useActorPool()` inside a `defineScene` factory to automatically call `destroyAll()`
when the scene exits:

```ts
import { defineScene, onEnter, onExit } from '@gwenjs/core/scene'
import { useActorPool } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  useActorPool(BulletPool)
  // BulletPool.destroyAll() is called automatically on scene exit

  onEnter(() => {
    // Pool is ready to use
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
BulletPool.stats()
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

## Observable Hooks

React to pool events from outside:

```ts
BulletPool.hooks.hook('pool:warn',     ({ ratio }) => console.warn('pool pressure', ratio))
BulletPool.hooks.hook('pool:critical', ({ active, size }) => spawnRateController.reduce())
BulletPool.hooks.hook('pool:acquire',  ({ id }) => analytics.track('bullet-spawn'))
BulletPool.hooks.hook('pool:release',  ({ id }) => analytics.track('bullet-release'))
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
  const id = BulletPool.acquire({ speed: 800, x: player.x, y: player.y })
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
const engine = useEngine()  // captured in scene factory setup phase

onEnter(async () => {
  // Pre-fill the pool before gameplay starts to avoid hitches
  const ids = Array.from({ length: 50 }, () => BulletPool.acquire())
  for (const id of ids) BulletPool.release(id)
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
| `useActorPool(pool)` | `@gwenjs/core/actor` |
| `onRelease(fn)` | `@gwenjs/core/actor` |
| `onReset(fn)` | `@gwenjs/core/actor` |
| `DormantTag` | `@gwenjs/core/actor` |
| `PoolExhaustedError` | `@gwenjs/core/actor` |
| `ActorPool<Props, PublicAPI>` | `@gwenjs/core/actor` |
| `PoolOptions` | `@gwenjs/core/actor` |
| `PoolStats` | `@gwenjs/core/actor` |
| `PoolHooks` | `@gwenjs/core/actor` |

## Manual plugin registration

::: info Automatic with Gwen
In a standard Gwen project, `engine.use()` calls are generated automatically by the Vite plugin — you don't need to write this yourself.
:::

If you're using the engine directly (custom setup, tests, or outside of a Gwen project), register the pool plugin manually **after** the actor plugin:

```ts
// main.ts — only needed outside a standard Gwen project
await engine.use(BulletActor._plugin)  // actor first
await engine.use(BulletPool._plugin)   // then the pool
```

## Next Steps

- **[Actor Leak Detection](/advanced/actor-leak-detection)** — Detect actors that are never despawned or released.
- **[Actors](/essentials/actors)** — Actor lifecycle: spawn, despawn, and public API.
- **[Hooks & Events](/advanced/hooks)** — The engine hook system used by pool events.
