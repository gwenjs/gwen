---
title: Actors
description: Composable, instance-based game objects with their own entity and lifecycle.
---

# Actors

An **Actor** is a composable, instance-based game object. Each actor instance owns a single ECS entity and runs lifecycle hooks (`onStart`, `onUpdate`, `onDestroy`) independently. Actors are defined with `defineActor()` and registered with `engine.use()`.

## Defining an Actor

`defineActor(prefab, factory)` takes a prefab (component layout) and a factory function that sets up lifecycle hooks and returns a public API:

```ts
import { defineActor, onStart, onDestroy, onUpdate } from '@gwenjs/core'
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

Register the actor's plugin with the engine before spawning:

```ts
// main.ts
import { createEngine } from '@gwenjs/core'
import { EnemyActor } from './actors/Enemy'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(EnemyActor._plugin)
await engine.start()
```

## Spawning and Despawning

```ts
// Spawn — returns the entity ID
const id = EnemyActor._plugin.spawn({ hp: 100 })

// Despawn — calls onDestroy and removes the entity
EnemyActor._plugin.despawn(id)

// Get a reference (if you stored the ID)
const actor = EnemyActor._plugin.get(id)
actor.takeDamage(10)
```

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

## Accessing Components

Use `useComponent()` to get and mutate a component:

```ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core'
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
import { defineActor, useSceneRouter, onUpdate, useComponent } from '@gwenjs/core'
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
import { definePrefab } from '@gwenjs/core'
import { Position, Velocity, Health } from '../components'

export const EnemyPrefab = definePrefab({
  Position: { x: 0, y: 0 },
  Velocity: { x: 0, y: 0 },
  Health: { hp: 50, maxHp: 50 },
})

// src/actors/Enemy.ts
import { defineActor, onStart, onUpdate, onDestroy, useComponent } from '@gwenjs/core'
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

// src/main.ts
import { createEngine } from '@gwenjs/core'
import { EnemyActor } from './actors/Enemy'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(EnemyActor._plugin)
await engine.start()

// Spawn some enemies
EnemyActor._plugin.spawn({ speed: 50 })
EnemyActor._plugin.spawn({ speed: 75 })
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
| `actor._plugin.spawn(props)` | Spawn an instance (returns entity ID) |
| `actor._plugin.despawn(id)` | Despawn an instance |
| `actor._plugin.get(id)` | Get the public API reference |
| `useComponent(ComponentType)` | Access a component inside factory |
| `useSceneRouter(router)` | Navigate between scenes |
| `onStart(fn)` | Runs once at spawn |
| `onUpdate(fn)` | Runs every frame |
| `onDestroy(fn)` | Runs at despawn |

## Next Steps

- **[Prefabs](/essentials/prefabs)** — Define the component layout for actors.
- **[Scene Router](/essentials/scene-router)** — Navigate between scenes from inside actors.
- **[Systems](/essentials/systems)** — Implement batch logic that runs across many entities.
