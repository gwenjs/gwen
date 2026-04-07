---
title: Actors
description: Composable, instance-based game objects with their own entity and lifecycle.
---

# Actors

An **Actor** is a composable, instance-based game object. Each actor instance owns a single ECS entity and runs lifecycle hooks (`onStart`, `onUpdate`, `onDestroy`) independently. Actors are defined with `defineActor()` and registered with `engine.use()`.

## Defining an Actor

`defineActor(prefab, factory)` takes a prefab (component layout) and a factory function that sets up lifecycle hooks and returns a public API:

```ts
import { defineActor, onStart, onDestroy, onUpdate } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  onStart(() => {
    console.log('Enemy spawned, hp:', hp)
  })

  onUpdate((dt) => {
    // runs every frame for this instance
  })

  onDestroy(() => {
    console.log('Enemy destroyed')
  })

  return {
    takeDamage: (amount: number) => { hp -= amount },
    getHp: () => hp,
  }
})
```

The factory function receives:
- `props` — Custom data passed when spawning
- Lifecycle hooks — `onStart`, `onUpdate`, `onDestroy`, etc.

The returned object is the **public API** — methods that external code can call on the actor.

## Registration

Register the actor's plugin with the engine before spawning. Pass `actor._plugin` to `engine.use()` at startup.

## Spawning and Despawning

Use `useActor()` inside a system or actor setup phase to get a typed handle:

```ts
import { useActor } from '@gwenjs/core/actor'
import { defineSystem } from '@gwenjs/core/system'
import { EnemyActor } from './actors/enemy'

export const SpawnerSystem = defineSystem(() => {
  const enemies = useActor(EnemyActor)

  // Spawn — returns the entity ID
  const id = enemies.spawn({ hp: 100 })

  // Despawn — calls onDestroy and removes the entity
  enemies.despawn(id)

  // Get the first live instance's public API
  const enemy = enemies.get()
  enemy?.takeDamage(10)

  // Get all live instances
  for (const e of enemies.getAll()) {
    e.takeDamage(5)
  }

  // Despawn every instance at once
  enemies.despawnAll()
})
```

`useActor()` returns an `ActorHandle` with:

| Method | Description |
|---|---|
| `spawn(props?)` | Create an instance, returns entity ID |
| `despawn(id)` | Remove a specific instance |
| `despawnAll()` | Remove all live instances |
| `count()` | Number of live instances |
| `get()` | Public API of the first live instance (`undefined` if none) |
| `getAll()` | Public API of every live instance |
| `spawnOnce(props?)` | Spawn only if no live instance exists yet (singleton) |

## Lifecycle Composables

These composables run inside the actor's factory function:

| Composable | When it runs |
|---|---|
| `onStart(fn)` | Once, immediately after spawn |
| `onUpdate(fn)` | Every frame (receives `dt` in ms) |
| `onBeforeUpdate(fn)` | Before the main update phase |
| `onAfterUpdate(fn)` | After the main update phase |
| `onRender(fn)` | During the render phase |
| `onDestroy(fn)` | Once, before the entity is removed |
| `onEvent(name, fn)` | When a named engine hook fires |

## Transform

Each actor instance has access to its spatial transform via `useTransform()`. The handle operates directly on the shared WASM memory buffer — views are always live after `memory.grow()` calls.

```typescript
import { defineActor, useTransform, onStart } from '@gwenjs/core/actor'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, (props: { x: number; y: number }) => {
  const transform = useTransform()

  onStart(() => {
    transform.setPosition(props.x, props.y, 0)
    transform.setScale(1, 1, 1)
  })

  return {}
})
```

`TransformHandle` methods:

| Method | Description |
|---|---|
| `setPosition(x, y, z)` | Set world position |
| `setRotation(rx, ry, rz)` | Set Euler rotation (radians) |
| `setScale(sx, sy, sz)` | Set scale |

## Typed Events

Use `defineEvents()` to declare your game's event contracts in one place, then share them across actors and systems.

```ts
// src/events/enemy.ts
import { defineEvents } from '@gwenjs/core/actor'

export const EnemyEvents = defineEvents({
  'enemy:hit': (damage: number) => {},
  'enemy:die': () => {},
})
```

`defineEvents` is a declaration tool — it names and groups your events so every part of your code works from the same contract.

### Emitting Events

Call `emit()` from inside an actor or system to fire an event:

```ts
import { defineActor, emit } from '@gwenjs/core/actor'
import { EnemyEvents } from '../events/enemy'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  return {
    takeDamage: (damage: number) => {
      hp -= damage
      emit('enemy:hit', damage)
      if (hp <= 0) emit('enemy:die')
    },
  }
})
```

### Listening from an Actor

Use `onEvent()` inside a `defineActor` factory to listen. The handler is automatically removed when the actor is destroyed — no cleanup needed:

```ts
import { defineActor, onEvent, onStart } from '@gwenjs/core/actor'
import { HUDPrefab } from '../prefabs'

export const HUDActor = defineActor(HUDPrefab, () => {
  let hits = 0

  onEvent('enemy:hit', (damage) => {
    hits++
    console.log(`Enemy hit for ${damage} damage (total hits: ${hits})`)
  })

  onEvent('enemy:die', () => {
    console.log('Enemy eliminated')
  })

  return {}
})
```

### Listening from a System

Use `useHook()` inside a `defineSystem` setup to listen from a system. It automatically unsubscribes when the engine stops:

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(function ScoreSystem() {
  let score = 0

  // Auto-cleanup when the engine stops
  useHook('enemy:die', () => {
    score += 100
    console.log('Score:', score)
  })

  useHook('enemy:hit', (damage) => {
    score += damage
  })
})
```

::: tip Naming convention
Prefix event names with a namespace: `'enemy:hit'`, `'player:die'`, `'ui:open'`. This avoids collisions with built-in engine hooks like `'engine:tick'` or `'entity:spawn'`.
:::

## Accessing Components

Use `useComponent()` to get and mutate a component:

```ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core/actor'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      // Handle death
    }
  })

  return {}
})
```

## Accessing the Router

Inside an actor, use `useSceneRouter()` to navigate between scenes:

```ts
import { defineActor, onUpdate, useComponent } from '@gwenjs/core/actor'
import { useSceneRouter } from '@gwenjs/core/scene'
import { AppRouter } from '../router'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('DIE')  // Transition to game over
    }
  })

  return {}
})
```

## Complete Example

```ts
// src/prefabs/Enemy.ts
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Health } from '../components'

export const EnemyPrefab = definePrefab({
  Position: { x: 0, y: 0 },
  Velocity: { x: 0, y: 0 },
  Health: { hp: 50, maxHp: 50 },
})

// src/actors/Enemy.ts
import { defineActor, onStart, onUpdate, onDestroy, useComponent } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs/Enemy'
import { Health, Velocity } from '../components'

export const EnemyActor = defineActor(EnemyPrefab, (props: { speed: number }) => {
  const health = useComponent(Health)
  const velocity = useComponent(Velocity)

  onStart(() => {
    console.log(`Enemy spawned with ${health.value.hp} HP`)
    velocity.value.x = Math.random() * props.speed - props.speed / 2
  })

  onUpdate(() => {
    if (health.value.hp <= 0) {
      // Will be despawned
    }
  })

  onDestroy(() => {
    console.log('Enemy destroyed')
  })

  return {
    takeDamage: (amount: number) => {
      health.value.hp = Math.max(0, health.value.hp - amount)
    },
    getHp: () => health.value.hp,
  }
})
```

## Actors vs Systems

| | Actor | System |
|---|---|---|
| **Scope** | Per-instance | Global |
| **Entity** | Owns one entity | Queries many entities |
| **Use case** | Individual game objects (player, enemies, projectiles) | Batch logic (physics, AI sweep, collision) |
| **State** | Local to instance | Global |

Use actors for **unique, named entities**. Use systems for **bulk operations** on sets of entities.

## API Summary

| | |
|---|---|
| `defineActor(prefab, factory)` | Create an actor type |
| `actor._plugin` | The plugin to register with `engine.use()` |
| `useActor(actorDef)` | Get a typed handle (call in setup phase) |
| `handle.spawn(props?)` | Spawn an instance, returns entity ID |
| `handle.despawn(id)` | Despawn a specific instance |
| `handle.despawnAll()` | Despawn all live instances |
| `handle.count()` | Number of live instances |
| `handle.get()` | Public API of the first live instance |
| `handle.getAll()` | Public APIs of all live instances |
| `handle.spawnOnce(props?)` | Spawn singleton (noop if already live) |
| `useComponent(ComponentType)` | Access a component inside factory |
| `useTransform()` | Access the actor's spatial transform |
| `useSceneRouter(router)` | Navigate between scenes |
| `defineEvents(map)` | Declare a typed event contract (shared across actors and systems) |
| `emit(event, ...args)` | Dispatch an event from any active engine context |
| `onEvent(event, handler)` | Listen to an event inside an actor (auto-removed on destroy) |
| `useHook(event, handler)` | Subscribe to an engine or game event (auto-cleanup) — import from `@gwenjs/core` |
| `onStart(fn)` | Runs once at spawn |
| `onUpdate(fn)` | Runs every frame |
| `onDestroy(fn)` | Runs at despawn |

## Next Steps

- **[Prefabs](/essentials/prefabs)** — Define the component layout for actors.
- **[Scene Router](/essentials/scene-router)** — Navigate between scenes from inside actors.
- **[Systems](/essentials/systems)** — Implement batch logic that runs across many entities.
