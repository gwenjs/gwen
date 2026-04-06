---
title: Systems
description: Systems are where all game logic lives in GWEN. Learn to define and compose them.
---

# Systems

A **system** is a function that runs every frame and reads/writes component data. Systems are the game logic layer of GWEN's ECS. This guide shows you how to define systems, query entities, and access services.

## The Basics

### Defining a System

Use `defineSystem()` to declare a system. Inside the setup function, register callbacks that run during the game loop:

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  // Setup phase: runs once when the system initializes
  const entities = useQuery([Position, Velocity])

  // Frame callback: runs every frame
  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

Systems are registered in a scene:

```ts
import { Scene } from '@gwenjs/core'

export class GameScene extends Scene {
  onLoad() {
    this.addSystem(MovementSystem)
    this.addSystem(DamageSystem)
    this.addSystem(RenderSystem)
  }
}
```

### Why Split Setup and Frame Phases?

The setup phase is expensive (queries are computed once), but the frame phase is lightweight (just data access). This two-phase design means:

- **Setup** — `useQuery()` scans all entities once, building the matching set
- **Frame** — `onUpdate()` iterates over the cached query result (very fast)

If queries were recomputed every frame, your game would be slow.

## Lifecycle Hooks

Systems have several callback hooks available:

| Hook | Signature | When | Use Case |
|---|---|---|---|
| `onStart()` | `onStart(cb: () => void)` | Once when scene starts | Initialize state, load assets |
| `onUpdate()` | `onUpdate(cb: (dt: number) => void)` | Every frame | Update positions, check collisions |
| `onDestroy()` | `onDestroy(cb: () => void)` | When scene unloads | Clean up, save state |
| `onEvent()` | `onEvent(type, cb: (data) => void)` | When event fires | React to custom events |

Example:

```ts
import { defineSystem, onStart, onUpdate, onDestroy } from '@gwenjs/core'

export const MySystem = defineSystem(() => {
  let totalDamage = 0

  onStart(() => {
    console.log('System initialized')
  })

  onUpdate((dt) => {
    // Update game state
    totalDamage += dt
  })

  onDestroy(() => {
    console.log(`Total damage: ${totalDamage}`)
  })
})
```

## Queries

### Basic Query

Query for all entities with a set of components:

```ts
const entities = useQuery([Position, Velocity])

onUpdate((dt) => {
  for (const id of entities) {
    // Process all entities with Position and Velocity
  }
})
```

### Excluding Components

Exclude entities that have a certain component (often a tag):

```ts
const alive = useQuery([Health], { exclude: [DeadTag] })

onUpdate(() => {
  for (const id of alive) {
    // Only process living entities
  }
})
```

### Reactive Queries

Queries are reactive. If an entity gains or loses a component, the query result updates automatically:

```ts
const entities = useQuery([Health, Armor])

onUpdate(() => {
  // If an entity gets its Armor removed, it won't be in 'entities' next frame
  for (const id of entities) {
    // ...
  }
})
```

## Accessing Services

Plugins expose services you can access from systems using `use*` hooks:

### Physics Service

```ts
import { defineSystem, onUpdate, usePhysics2D } from '@gwenjs/core'

export const PhysicsSystem = defineSystem(() => {
  const physics = usePhysics2D()

  onUpdate(() => {
    const bodies = physics.queryAABB({ x: 0, y: 0, w: 100, h: 100 })
    // Handle physics queries
  })
})
```

### Engine Access

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyDown('ArrowRight')) {
      // Handle input
    }
  })
})
```

## In Practice

### Enemy AI System

Here's a complete example: enemies that move toward the player:

```ts
import { defineSystem, useQuery, onUpdate, useEngine } from '@gwenjs/core'
import { Position, Velocity, EnemyTag, PlayerTag } from './components'

const ENEMY_SPEED = 50 // pixels per second

export const EnemyAISystem = defineSystem(() => {
  const enemies = useQuery([Position, Velocity, EnemyTag])
  const player = useQuery([Position, PlayerTag])

  onUpdate((dt) => {
    if (player.length === 0) return

    const playerPos = {
      x: Position.x[player[0]],
      y: Position.y[player[0]],
    }

    for (const id of enemies) {
      const dx = playerPos.x - Position.x[id]
      const dy = playerPos.y - Position.y[id]
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > 0) {
        Velocity.x[id] = (dx / dist) * ENEMY_SPEED
        Velocity.y[id] = (dy / dist) * ENEMY_SPEED
      }
    }
  })
})
```

### Damage System

```ts
import {
  defineSystem,
  useQuery,
  onUpdate,
  removeComponent,
  addComponent,
} from '@gwenjs/core'
import {
  Health,
  DamageTag,
  DeadTag,
  Armor,
} from './components'

export const DamageSystem = defineSystem(() => {
  const damaged = useQuery([Health, DamageTag])

  onUpdate(() => {
    for (const id of damaged) {
      const armorValue = Armor.value[id] ?? 0
      const damageReduction = armorValue / (armorValue + 10)
      Health.current[id] -= 10 * (1 - damageReduction)

      if (Health.current[id] <= 0) {
        removeComponent(id, Health)
        addComponent(id, DeadTag)
      }

      removeComponent(id, DamageTag)
    }
  })
})
```

## System Ordering

Systems run in the order you add them to the scene. If `RenderSystem` depends on `PhysicsSystem`, add physics first:

```ts
export class GameScene extends Scene {
  onLoad() {
    this.addSystem(PhysicsSystem)      // Runs first
    this.addSystem(MovementSystem)     // Runs second
    this.addSystem(CollisionSystem)    // Runs third
    this.addSystem(RenderSystem)       // Runs last (reads updated positions)
  }
}
```

## Error Handling in Systems

Errors in a system's `onUpdate` callback are caught and logged. The game continues:

```ts
import { defineSystem, onUpdate } from '@gwenjs/core'

export const SafeSystem = defineSystem(() => {
  onUpdate(() => {
    try {
      // Risky operation
    } catch (err) {
      console.error('System error:', err)
      // Game continues
    }
  })
})
```

For unrecoverable errors, emit an event:

```ts
import { defineSystem, useEngine } from '@gwenjs/core'

export const EngineAwareSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (somethingBad) {
      engine.emit('error', { message: 'Something went wrong' })
      engine.loadScene('menu')
    }
  })
})
```

## Deep Dive

### Setup vs. Frame Performance

When you call `useQuery([Position, Velocity])` in the setup phase, GWEN:

1. Scans all entities
2. Builds a list of IDs matching `[Position, Velocity]`
3. Caches the result

When the query changes (an entity gains/loses a component), the result is recalculated. But during the frame loop, iteration is **O(n)** where n is the query size, not the total entity count.

**Without caching (slow):**
```
for each entity in the world {
  if it has Position and Velocity {
    // process
  }
}
// O(total entities) per frame
```

**With caching (fast):**
```
entities = [id1, id2, id3, ...] // computed once
for each entity in entities {
  // process
}
// O(matching entities) per frame
```

### System Composition

Complex behavior emerges from simple systems. Here's a complete example:

```ts
// Systems update components independently
- MovementSystem updates Position based on Velocity
- DamageSystem updates Health based on DamageTag
- RenderSystem reads Position and renders
- PhysicsSystem handles collisions

// No system depends on another's output directly
// Data flows through components
```

This **decoupling** is why ECS scales. Add a new system? No refactoring needed—just define a new one.

## API Summary

| Function | Description |
|---|---|
| `defineSystem(setup)` | Declare a system |
| `useQuery(components, opts?)` | Reactive entity set matching components |
| `onUpdate(cb)` | Register frame callback |
| `onStart(cb)` | Run once when scene starts |
| `onDestroy(cb)` | Run when scene unloads |
| `onEvent(type, cb)` | Listen to custom events |
| `useEngine()` | Access engine instance |
| `usePhysics2D()` | Access physics service |
| `addComponent(id, Component, data)` | Add component to entity |
| `removeComponent(id, Component)` | Remove component from entity |

## Next Steps

- **[Components](/essentials/components)** — Define the data your systems will manipulate.
- **[Architecture](/essentials/architecture)** — Understand how systems fit into ECS.
- **[Scenes and Actors](/essentials/scenes)** — Learn how to organize systems in scenes.
