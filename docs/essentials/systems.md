---
title: Systems
description: Systems are where all game logic lives in GWEN. Learn to define them, inject dependencies, and control their lifecycle.
---

# Systems

A **system** is a function that runs every frame and reads/writes component data. Systems are the game logic layer of GWEN's ECS.

## Defining a System

Use `defineSystem()` to declare a system. It returns a **factory function** — you call it to produce a plugin, then pass that plugin to `useSystem()` inside a scene.

```ts
import { defineSystem, onUpdate, useQuery } from '@gwenjs/core/system'
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

## Registering Systems in a Scene

Call `useSystem()` once per system inside `defineScene()`. Each call returns a `SystemHandle`:

```ts
import { defineScene, useSystem } from '@gwenjs/core/scene'

export const GameScene = defineScene('game', () => {
  const movement = useSystem(MovementSystem())
  const render   = useSystem(RenderSystem())
})
```

## System Naming

The engine uses a name to identify each system (deduplication and debugging). With `gwenVitePlugin`, the name is **injected automatically** from the exported variable. Without the Vite plugin (tests, Node.js), pass it explicitly:

```ts
// ✅ With Vite plugin — name inferred from export const
export const MovementSystem = defineSystem(() => { ... })

// ✅ Without Vite plugin — explicit name
export const MovementSystem = defineSystem('MovementSystem', () => { ... })
```

## Dependency Injection

Systems can declare typed dependencies as parameters. The scene wires them at setup time, keeping the system decoupled from concrete actor types.

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'

// Accepts any object with a takeDamage method — not tied to PlayerActor
export const CombatSystem = defineSystem((target: { takeDamage(n: number): void }) => {
  onUpdate(() => target.takeDamage(5))
})
```

In the scene:

```ts
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { useActor } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)

  const movement = useSystem(MovementSystem())
  const combat   = useSystem(CombatSystem(player))  // player implements the interface

  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

## SystemHandle — Lifecycle Control

`useSystem()` returns a `SystemHandle`:

```ts
interface SystemHandle {
  pause(): void    // stop frame callbacks, preserve state
  resume(): void   // restart callbacks
  destroy(): void  // permanently remove from frame loop
  readonly active: boolean
}
```

```ts
const combat = useSystem(CombatSystem(player))

// During a cinematic — pause combat logic
combat.pause()

// After the cinematic ends
combat.resume()
```

### Pause and Scene Overlays

If a scene overlay (e.g. a pause menu) freezes the underlying scene, systems are automatically scene-paused by the engine. A system you paused yourself **will not** be reactivated when the overlay closes — only the engine's scene-pause is cleared:

```ts
combat.pause()           // you pause combat during a cutscene

// player opens pause menu → engine scene-pauses all systems
// player closes pause menu → engine scene-resumes non-user-paused systems

// combat is still paused because YOU paused it
combat.resume()          // explicitly resume when cutscene ends
```

## Actor Dependency Auto-Discovery

If a system uses `useActor()` internally (for actors it owns), GWEN discovers and installs the actor plugin automatically — you do not need to declare it separately in the scene:

```ts
export const SpawnSystem = defineSystem(() => {
  const asteroid = useActor(AsteroidActor)  // owned by this system
  onUpdate((dt) => {
    asteroid.spawn({ x: randomX(), y: -10 })
  })
})

// In the scene — no explicit useActor(AsteroidActor) needed:
export const GameScene = defineScene('game', () => {
  useSystem(SpawnSystem())  // AsteroidActor is auto-discovered and installed
})
```

## Frame Phases

Register callbacks in the correct phase:

| Composable | Phase | Typical use |
|---|---|---|
| `onBeforeUpdate(dt)` | Before physics/WASM | Input sampling, pre-simulation |
| `onUpdate(dt)` | Main update | Game logic, AI, movement |
| `onAfterUpdate(dt)` | Post-update | State sync, scoring |
| `onRender()` | Render | Draw calls (no `dt`) |

```ts
export const InputSystem = defineSystem(() => {
  onBeforeUpdate((dt) => { /* read input */ })
  onUpdate((dt)       => { /* apply movement */ })
  onAfterUpdate((dt)  => { /* update debug HUD */ })
  onRender(()         => { /* draw debug overlay */ })
})
```
