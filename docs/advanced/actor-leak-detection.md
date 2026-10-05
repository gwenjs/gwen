---
title: Actor Leak Detection
description: Detect and prevent actor instance leaks with watchActorLeaks.
---

# Actor Leak Detection

Actor leaks are one of the most common performance bugs in GWEN games: actors are spawned every frame (or on every scene entry) but never despawned. The result is unbounded memory growth — `_instances` Maps grow forever, frame iteration gets slower, and garbage collection becomes expensive.

This page covers how to detect these leaks at runtime and how to prevent them from happening in the first place.

## What is an Actor Leak?

Each call to `actor.spawn()` creates an `ActorInstance` in memory: callback arrays, a `bigint` entity ID, composable handles, and your actor's public API. When `despawn()` or `despawnAll()` is never called, those instances accumulate for the lifetime of the application.

The two most common causes:

**1. Spawning inside `onUpdate` without matching despawns**

```ts
// ❌ creates a new instance every frame — never removed
const EnemyScene = defineScene('game', () => {
  const bullet = useActor(BulletActor)

  onEnter(() => {
    useSystem(ShootingSystem(bullet))
  })
})

export const ShootingSystem = defineSystem(() => {
  const bullet = useActor(BulletActor)

  onUpdate(() => {
    bullet.spawn({ x: player.x, y: player.y }) // ← leaks if no matching despawn
  })
})
```

**2. A scene that spawns actors but forgets `onExit`**

```ts
// ❌ actors survive scene transitions
const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const enemies = useActor(EnemyActor)

  onEnter(() => {
    player.spawnOnce()
    enemies.spawn({ hp: 100 })
  })
  // missing: onExit(() => { player.despawnAll(); enemies.despawnAll() })
})
```

## Detecting Leaks with `watchActorLeaks`

`watchActorLeaks` polls a set of actor definitions at a fixed interval. When it observes an actor's live instance count growing for N consecutive checks without decreasing, it emits a `console.warn` pointing to the `despawnAll()` pattern.

```ts
import { watchActorLeaks } from '@gwenjs/core/actor'

// main.ts — development only
if (__GWEN_DEV__) {
  watchActorLeaks([PlayerActor, EnemyActor, BulletActor])
}
```

When a leak is detected, you will see:

```
[GWEN] Possible actor leak detected: "BulletActor" has 847 live instances
(+14 since last check). Call despawn() or despawnAll() when done,
or add onExit(() => actor.despawnAll()) to the enclosing scene.
```

The warning fires only after `growthStreak` consecutive growth intervals so burst-spawn patterns (spawning many bullets at once, then cleaning them up) do not produce false positives.

### Options

```ts
watchActorLeaks(actorDefs, {
  intervalMs: 5_000,   // how often to poll (default: 5000ms)
  growthStreak: 3,     // consecutive growing intervals before warning (default: 3)
  onLeak: (name, count, delta) => {
    // custom reporter — receives actor name, current count, and delta since last check
    myTelemetry.warn('actor-leak', { name, count, delta })
  },
})
```

| Option | Type | Default | Description |
|---|---|---|---|
| `intervalMs` | `number` | `5000` | Polling interval in milliseconds |
| `growthStreak` | `number` | `3` | Consecutive growth observations to trigger `onLeak` |
| `onLeak` | `function` | `console.warn` | Called when a leak is detected |

### Stopping the monitor

`watchActorLeaks` returns a `stop` function. Call it before engine teardown or in test `afterEach`:

```ts
const stop = watchActorLeaks([BulletActor])

// later…
stop()
```

::: tip Tree-shaking
Wrap the call in `if (__GWEN_DEV__)` so production builds remove it. At runtime, `setInterval` is the only overhead — zero cost in production.
:::

## Fixing the Leaks

### Scene-level actors: always pair `onEnter` with `onExit`

```ts
const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const enemies = useActor(EnemyActor)

  onEnter(() => {
    player.spawnOnce()
    enemies.spawn({ hp: 100 })
  })

  // ✅ actors are removed when the scene transitions away
  onExit(() => {
    player.despawnAll()
    enemies.despawnAll()
  })
})
```

### Dynamic actors: track and despawn individually

```ts
export const ShootingSystem = defineSystem(() => {
  const bullet = useActor(BulletActor)
  const liveIds: bigint[] = []

  onUpdate((dt) => {
    if (shouldShoot) {
      const id = bullet.spawn({ x: player.x, y: player.y })
      liveIds.push(id)
    }

    // Despawn bullets that have left the screen
    for (let i = liveIds.length - 1; i >= 0; i--) {
      const id = liveIds[i]!
      if (isOffScreen(id)) {
        bullet.despawn(id)
        liveIds.splice(i, 1)
      }
    }
  })
})
```

### Singleton actors: use `spawnOnce`

```ts
onEnter(() => {
  // spawnOnce() is idempotent — safe to call even if the actor is already alive
  player.spawnOnce({ x: 400, y: 530 })
})
```

## Testing Actor Lifecycle

Write tests that assert `_instances.size === 0` after scene exit — they fail immediately if a despawn is missing:

```ts
import { describe, it, expect } from 'vitest'
import { createEngine } from '@gwenjs/core'

describe('GameScene lifecycle', () => {
  it('despawns all actors when the scene exits', async () => {
    const engine = await createEngine({ maxEntities: 100 })

    // enter the scene
    await engine.hooks.callHook('scene:enter', {})
    expect(PlayerActor._instances.size).toBe(1)
    expect(EnemyActor._instances.size).toBe(3)

    // exit the scene
    await engine.hooks.callHook('scene:exit', {})

    // ✅ nothing left — no leak
    expect(PlayerActor._instances.size).toBe(0)
    expect(EnemyActor._instances.size).toBe(0)
  })
})
```

Combined with `watchActorLeaks` in dev mode, lifecycle tests are the most reliable way to prevent actor leaks from reaching production.

## Using Heap Snapshots

For leaks that are harder to attribute, Chrome DevTools' **Memory** tab lets you compare snapshots over time. When comparing two snapshots, filter the constructor list by the closures you care about: look for `get world`, `setPosition`, `translate`, or other `useTransform` method names.

If their counts grow linearly between snapshots, the corresponding actor type is leaking.

```
Snapshot 1 → Snapshot 2 → Snapshot 3

closure::get world     782 → 2 885 → 5 533   (+4 751)  ← leak
closure::setPosition   782 → 2 885 → 5 533   (+4 751)  ← same actor
bigint::bigint         787 → 2 890 → 5 538   (+4 751)  ← entity IDs
```

Each `useTransform()` call creates one `TransformHandle` with these methods. A count that grows at the same rate as the actor's entity ID bigints means that actor type has an exact match — it is leaking exactly that many instances.

## API Reference

| Export | From |
|---|---|
| `watchActorLeaks(defs, options?)` | `@gwenjs/core/actor` |
| `WatchActorLeaksOptions` | `@gwenjs/core/actor` |

## Next Steps

- **[Debug Mode](/advanced/debug-mode)** — Engine-wide debug flags, logging, and timing overlays.
- **[Actors](/essentials/actors)** — Actor lifecycle: spawn, despawn, and public API.
- **[Scenes](/essentials/scenes)** — How `onEnter` and `onExit` fit into scene transitions.