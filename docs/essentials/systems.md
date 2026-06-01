---
title: Systems
description: Systems are where all game logic lives in GWEN. Learn to define them, query entities, and use all system-context composables.
---

# Systems

A **system** is a function that runs every frame and reads/writes component data. Systems are the game logic layer of GWEN's ECS.

::: info Auto-imports
In a GWEN project, composables are available without any `import` statement — the framework generates global type declarations at build time. You write `defineSystem(...)`, `useQuery(...)`, `onUpdate(...)` directly, with no import.

One exception requires an explicit import:
```ts
import { useHook, emit } from '@gwenjs/core'  // event system
```
:::

## Setup vs Runtime

The `defineSystem` factory body runs **once** when the system is installed — this is the *setup phase*. Frame callbacks (`onUpdate`, etc.) run every frame — this is the *runtime phase*.

```ts
export const MovementSystem = defineSystem(() => {

  // ── Setup phase (once at install) ──────────────────────────────
  const entities = useQuery([Position, Velocity])  // live query, updates automatically
  const audio    = useService('audio')             // resolved once

  // ── Runtime phase (every frame) ────────────────────────────────
  onUpdate((dt) => {
    for (const entity of entities) {
      Position.x[entity.id] += Velocity.x[entity.id] * dt
    }
  })
})
```

`defineSystem()` returns a **factory function** — call it to produce a plugin, then pass that to `useSystem()` inside a scene:

```ts
// In a scene:
useSystem(MovementSystem())
```

## Querying Entities

Use `useQuery()` to get a live collection of entities that have a specific set of components. The query updates automatically as entities are spawned and despawned.

```ts
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const entity of entities) {
      Position.x[entity.id] += Velocity.x[entity.id] * dt
      Position.y[entity.id] += Velocity.y[entity.id] * dt
    }
  })
})
```

`entity.id` is a `bigint` used to index the component's typed arrays directly. For reading a component as a plain object, use `entity.get(def)`:

```ts
onUpdate(() => {
  for (const entity of entities) {
    const pos = entity.get(Position) // { x: number, y: number } | undefined
  }
})
```

## Reading and Writing a Single Component

`useComponentFor(entityId, Def)` returns a mutable proxy for a specific entity's component. Reading a field fetches from ECS storage; writing a field calls `addComponent` to persist the change. Use `$set({ ... })` to batch multiple fields in a single write.

```ts
export const InputSystem = defineSystem(() => {
  const players = useQuery([Position, Velocity, PlayerTag])

  onUpdate((dt) => {
    for (const entity of players) {
      const pos = useComponentFor(entity.id, Position)
      const vel = useComponentFor(entity.id, Velocity)

      vel.vx = kb.isPressed(Keys.Left) ? -200 : kb.isPressed(Keys.Right) ? 200 : 0
      pos.x = Math.max(0, Math.min(800, pos.x + vel.vx * dt))

      // Batch write — one ECS call for both fields:
      pos.$set({ x: pos.x + vel.vx * dt, y: pos.y + vel.vy * dt })
    }
  })
})
```

::: tip Optimizer
`useComponentFor` inside a `for...of` query loop is detected by the GWEN Vite optimizer and rewritten to bulk WASM calls automatically. Write clear code — the optimizer handles the performance.
:::

## Frame Phases

Register callbacks in the correct phase for your use case:

| Composable | Phase | Typical use |
|---|---|---|
| `onBeforeUpdate(fn)` | Before physics/WASM | Input sampling, pre-simulation |
| `onUpdate(fn)` | Main update | Game logic, AI, movement |
| `onAfterUpdate(fn)` | Post-update | State sync, scoring |
| `onRender(fn)` | Render | Draw calls (no `dt`) |

```ts
export const InputSystem = defineSystem(() => {
  onBeforeUpdate((dt) => { /* read input */ })
  onUpdate((dt)       => { /* apply movement */ })
  onAfterUpdate((dt)  => { /* update debug HUD */ })
  onRender(()         => { /* draw debug overlay */ })
})
```

## Dependency Injection

Systems declare typed dependencies as parameters. The scene wires them at setup time, keeping the system decoupled from concrete implementations.

```ts
export const CombatSystem = defineSystem((target: { takeDamage(n: number): void }) => {
  onUpdate(() => target.takeDamage(5))
})
```

In the scene, pass the concrete value:

```ts
const player = useActor(PlayerActor)
useSystem(CombatSystem(player))  // player satisfies the interface
```

## Accessing Services

Use `useService(key)` to access a value provided by a plugin. Resolved once at setup time, used as a closure in callbacks.

```ts
export const AudioSystem = defineSystem(() => {
  const audio = useService('audio')  // provided by an audio plugin

  onUpdate(() => {
    // use audio service
  })
})
```

## Listening to Events

Use `useHook()` to subscribe to an engine or game event. The subscription is automatically removed when the scene exits.

```ts
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(() => {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
  })

  useHook('player:scored', (points: number) => {
    score += points
  })
})
```

::: info Explicit import required
`useHook` and `emit` are not auto-imported — always import them from `@gwenjs/core`.
:::

## Using Actors in a System

Use `useActor(def)` inside a system body to get a handle for spawning and despawning actor instances. GWEN auto-discovers and installs the actor plugin — no separate scene declaration needed.

```ts
import { AsteroidActor } from './actors/asteroid'

export const SpawnSystem = defineSystem(() => {
  const asteroid = useActor(AsteroidActor)

  onUpdate((dt) => {
    if (shouldSpawn) {
      asteroid.spawn({ x: randomX(), y: -10 })
    }
  })
})
```

## Navigating Between Scenes

Use `useSceneRouter(router)` to access the scene router from a system. Call `nav.send()` to trigger transitions.

```ts
import { AppRouter } from '../router'

export const GameOverSystem = defineSystem(() => {
  const nav = useSceneRouter(AppRouter)

  onUpdate(() => {
    if (noLivesRemaining) {
      nav.send('GAME_OVER')
    }
  })
})
```

## System Naming

The engine uses a name for deduplication and debugging. With `gwenVitePlugin`, the name is **injected automatically** from the exported variable name. Without the Vite plugin (tests, Node.js), pass it explicitly:

```ts
// ✅ With Vite plugin — name inferred from export const
export const MovementSystem = defineSystem(() => { ... })

// ✅ Without Vite plugin — explicit name
export const MovementSystem = defineSystem('MovementSystem', () => { ... })
```

## SystemHandle — Lifecycle Control

`useSystem()` returns a `SystemHandle`:

```ts
const combat = useSystem(CombatSystem(player))

combat.pause()            // stop frame callbacks, preserve state
combat.resume()           // restart callbacks
combat.destroy()          // permanently remove from frame loop
combat.active             // boolean — true if running
```

::: warning Manual pause vs scene overlay
If a scene overlay (e.g. a pause menu) freezes the underlying scene, systems are automatically scene-paused by the engine. A system you paused yourself **will not** be reactivated when the overlay closes — only the engine's scene-pause is cleared. Call `combat.resume()` explicitly when your cutscene ends.
:::

## API Summary

| | |
|---|---|
| `defineSystem(factory)` | Declare a system |
| `useQuery([...defs])` | Live entity collection matching given components |
| `entity.id` | Entity ID (`bigint`) for SoA array access |
| `entity.get(def)` | Read component as plain object |
| `useComponentFor(id, Def)` | Mutable proxy for a single entity's component; `.field` reads, `.field = v` writes, `.$set({...})` batches |
| `onBeforeUpdate(fn)` | Before-update frame callback |
| `onUpdate(fn)` | Main update frame callback |
| `onAfterUpdate(fn)` | After-update frame callback |
| `onRender(fn)` | Render frame callback |
| `useService(key)` | Access a service provided by a plugin |
| `useHook(name, fn)` | Subscribe to an event — `import { useHook } from '@gwenjs/core'` |
| `useActor(def)` | Spawn/despawn actor instances |
| `useSceneRouter(router)` | Access scene router handle |
| `SystemHandle.pause()` | Pause frame callbacks |
| `SystemHandle.resume()` | Resume frame callbacks |
| `SystemHandle.destroy()` | Permanently remove system |
| `SystemHandle.active` | `true` if system is running |

## Next Steps

- **[Actors](/essentials/actors)** — Per-instance game objects with their own lifecycle.
- **[Scenes](/essentials/scenes)** — Register systems and control them at runtime.
- **[Hooks](/essentials/hooks)** — Define and use typed custom events.
