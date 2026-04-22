---
title: Nested Actor Dependencies
description: How GWEN automatically registers child actor plugins declared inside a defineActor() factory, and what to do when Vite is not available.
---

# Nested Actor Dependencies

When an actor manages other actors — a `BulletManagerActor` that spawns
`BulletActor`, for example — `useActor()` is called inside the factory body:

```ts
import { useHook } from '@gwenjs/core'

export const BulletManagerActor = defineActor(BulletManagerPrefab, () => {
  const bullet = useActor(BulletActor)  // ← dependency on BulletActor

  useHook('player:shoot', (x, y) => {
    bullet.spawn({ x, y })
  })

  return {}
})
```

Without special handling, `BulletActor`'s plugin would never be installed,
because `useActor()` inside an actor factory runs at **spawn time** (inside
`onEnter`), after the scene setup context has already closed. Calling
`bullet.spawn()` would throw `ACTOR:PLUGIN_NOT_READY`.

## Automatic resolution with `@gwenjs/vite`

When `@gwenjs/vite` is configured (via `gwenVitePlugin()`), this is handled
automatically at build time. The Vite plugin statically analyzes each
`defineActor` factory and injects a `_deps` list on the resulting plugin:

```ts
// What the Vite transform produces — you never write this by hand:
BulletManagerActor._plugin._deps = [BulletActor._plugin]
```

At runtime, when `useActor(BulletManagerActor)` is called in a scene factory,
GWEN reads `_deps` and registers `BulletActor`'s plugin as well — before the
scene bootstraps.

**No changes to your code are required.** Just declare `BulletManagerActor` in
the scene as you normally would:

```ts
export const GameScene = defineScene('game', () => {
  const manager = useActor(BulletManagerActor)  // BulletActor registered automatically
  // ✅ No need to also write: useActor(BulletActor)

  onEnter(() => manager.spawnOnce())
  onExit(() => manager.despawnAll())
})
```

## Limitations

### Dynamic `useActor` calls are not detected

The transform only recognises **static identifier** arguments. If you pass a
dynamic value, the dependency is not detected and you must declare it manually
in the scene:

```ts
// ❌ Not detected by the transform — declare BulletActor in the scene manually
const actor = useActor(list[index])

// ✅ Detected
const bullet = useActor(BulletActor)
```

### Without `@gwenjs/vite`

In environments without the Vite transform (e.g. plain Node.js scripts or
non-Vite test setups), `_deps` is never set. Declare all required actors
explicitly in the scene factory:

```ts
export const GameScene = defineScene('game', () => {
  useActor(BulletManagerActor)
  useActor(BulletActor)  // ← explicit fallback when Vite transform is absent
  // ...
})
```

### Transitive deps beyond depth 1

If `A` depends on `B` which depends on `C`, and only `A` is declared in the
scene, `B` is auto-registered but `C` is not. Declare `A` and `B` in the scene,
or add an explicit `useActor(C)`.

## Manager actor pattern

This feature is designed for the **manager actor pattern**: a lightweight,
singleton actor whose only role is to listen for events and spawn/despawn other
actors. The manager is the public interface; the managed actor is an
implementation detail.

```ts
// actors/laser-manager.ts
export const LaserManagerActor = defineActor(LaserManagerPrefab, () => {
  const laser = useActor(LaserActor)  // LaserActor registered automatically

  useHook('player:shoot', (x, y) => laser.spawn({ x, y }))

  return {}
})

// scenes/game.ts — only declare the manager
export const GameScene = defineScene('game', () => {
  const manager = useActor(LaserManagerActor)

  onEnter(() => manager.spawnOnce())
  onExit(() => manager.despawnAll())
})
```
