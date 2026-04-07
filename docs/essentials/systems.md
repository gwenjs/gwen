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
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
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
import { defineScene } from '@gwenjs/core/scene'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, DamageSystem, RenderSystem],
})
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
| `onUpdate()` | `onUpdate(cb: (dt: number) => void)` | Every frame | Update positions, check collisions |
| `onBeforeUpdate()` | `onBeforeUpdate(cb: (dt: number) => void)` | Before main update | Pre-process data |
| `onAfterUpdate()` | `onAfterUpdate(cb: (dt: number) => void)` | After main update | Post-process data |
| `onRender()` | `onRender(cb: () => void)` | During render phase | Render updates |

Example:

```ts
import { defineSystem, useQuery, onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from '@gwenjs/core/system'
import { Position, Velocity } from './components'

export const MySystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onBeforeUpdate((dt) => {
    // Pre-process step
  })

  onUpdate((dt) => {
    // Update game state
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
    }
  })

  onAfterUpdate((dt) => {
    // Post-process step
  })

  onRender(() => {
    // Render the updated state
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
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { usePhysics2D } from '@gwenjs/core'

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
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyDown('ArrowRight')) {
      // Handle input
    }
  })
})
```

### useService

Use `useService(key)` to access a runtime service registered by a plugin via `engine.provide()`. The return type is inferred from the `GwenProvides` interface. Plugins that register services augment this interface in their type declarations.

```typescript
import { defineSystem, useService, onUpdate } from '@gwenjs/core/system'

export const AudioSystem = defineSystem(() => {
  const audio = useService('audio') // typed via GwenProvides augmentation

  onUpdate(() => {
    if (audio.isLoaded('bgm')) audio.play('bgm')
  })
})
```

## Accessing WASM Modules

Use `useWasmModule(name)` to access a WASM module loaded by a plugin via `engine.loadWasmModule()`. The generic type parameter types the `.exports` object. The module must have been loaded by a plugin before this system runs.

```typescript
import { defineSystem, useWasmModule, onUpdate } from '@gwenjs/core/system'

export const PhysicsStepSystem = defineSystem(() => {
  const mod = useWasmModule<{ step: (dt: number) => void }>('my-physics')

  onUpdate((dt) => {
    mod.exports.step(dt)
  })
})
```

## In Practice

### Enemy AI System

Here's a complete example: enemies that move toward the player:

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'
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
} from '@gwenjs/core/system'
import {
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

Systems run in the order you list them in the scene. If `RenderSystem` depends on `PhysicsSystem`, add physics first:

```ts
export const GameScene = defineScene({
  name: 'game',
  systems: [
    PhysicsSystem,      // Runs first
    MovementSystem,     // Runs second
    CollisionSystem,    // Runs third
    RenderSystem,       // Runs last (reads updated positions)
  ],
})
```

## Error Handling in Systems

Errors in a system's `onUpdate` callback are caught and logged. The game continues:

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'

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
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const EngineAwareSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (somethingBad) {
      engine.errors.emit({
        level: 'error',
        code: 'GAME:UNRECOVERABLE',
        message: 'Something went wrong',
      })
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
| `onBeforeUpdate(cb)` | Register pre-update callback |
| `onAfterUpdate(cb)` | Register post-update callback |
| `onRender(cb)` | Register render phase callback |
| `useEngine()` | Access engine instance |
| `usePhysics2D()` | Access physics service |
| `useService(key)` | Access a runtime service registered via `engine.provide()` |
| `useWasmModule(name)` | Access a WASM module loaded via `engine.loadWasmModule()` |
| `addComponent(id, Component, data)` | Add component to entity |
| `removeComponent(id, Component)` | Remove component from entity |

## Next Steps

- **[Components](/essentials/components)** — Define the data your systems will manipulate.
- **[Architecture](/essentials/architecture)** — Understand how systems fit into ECS.
- **[Scenes and Actors](/essentials/scenes)** — Learn how to organize systems in scenes.
