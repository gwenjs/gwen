---
title: Components
description: Components are the data layer of GWEN's ECS. Learn to define and use them.
---

# Components

In GWEN's ECS, **components are pure data**. They hold typed fields but contain no logic or methods. Multiple components attach to the same entity to describe it completely. This guide shows you how to define components, understand their memory layout, and use them in systems.

## The Basics

### Defining a Component

Use `defineComponent()` to declare a component with a typed schema:

```ts
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})

export const Velocity = defineComponent({
  name: 'Velocity',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})

export const Health = defineComponent({
  name: 'Health',
  schema: {
    current: Types.i32,
    max: Types.i32,
  },
})
```

### Tag Components

A tag component has an empty schema—it's a marker that an entity has a certain property:

```ts
export const PlayerTag = defineComponent({
  name: 'PlayerTag',
  schema: {},
})

export const DeadTag = defineComponent({
  name: 'DeadTag',
  schema: {},
})
```

Tags are useful for filtering entities in queries without storing data.

### Accessing Component Data

Once a component is defined, you access its fields using array indexing by entity ID:

```ts
// Inside a system
const entities = useQuery([Position])

onUpdate(() => {
  for (const id of entities) {
    Position.x[id] = 100
    Position.y[id] = 200
    console.log(Position.x[id]) // 100
  }
})
```

Each field (e.g., `Position.x`, `Position.y`) is a `TypedArray` in WASM linear memory. You index it like a normal array.

## Available Types

GWEN supports these primitive types in component schemas:

| Type | TypeScript | Range | Use Case |
|---|---|---|---|
| `Types.f32` | `number` | 32-bit float | Positions, scales, rotations |
| `Types.f64` | `number` | 64-bit float | High-precision math |
| `Types.i32` | `number` | -2³¹ to 2³¹ - 1 | Counts, IDs, health |
| `Types.ui32` | `number` | 0 to 2³² - 1 | Unsigned counters, timers |
| `Types.i16` | `number` | -32768 to 32767 | Packed data, offsets |
| `Types.ui16` | `number` | 0 to 65535 | Packed data, texture indices |
| `Types.i8` | `number` | -128 to 127 | Byte flags, small counts |
| `Types.ui8` | `number` | 0 to 255 | Byte flags, char codes |

Choose types carefully: smaller types use less memory and improve cache efficiency.

## In Practice

### Composing Multiple Components

An entity gains behavior by combining components. Here's a common pattern:

```ts
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: { x: Types.f32, y: Types.f32 },
})

export const Health = defineComponent({
  name: 'Health',
  schema: { current: Types.i32, max: Types.i32 },
})

export const Armor = defineComponent({
  name: 'Armor',
  schema: { value: Types.f32 },
})

export const DeadTag = defineComponent({
  name: 'DeadTag',
  schema: {},
})

// Spawn an entity with multiple components
const engine = useEngine()
const enemyId = engine.spawn([
  [Position, { x: 100, y: 50 }],
  [Health, { current: 50, max: 50 }],
  [Armor, { value: 2.5 }],
])
```

Now systems can read and write this data:

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'

export const DamageSystem = defineSystem(() => {
  const enemies = useQuery([Health, Armor])

  onUpdate(() => {
    for (const id of enemies) {
      const armor = Armor.value[id]
      if (armor > 0) {
        Armor.value[id] *= 0.99 // Armor degrades over time
      }

      if (Health.current[id] <= 0) {
        // Mark as dead
        engine.addComponent(id, DeadTag)
      }
    }
  })
})
```

### Adding and Removing Components

Sometimes you need to add or remove a component from a living entity:

```ts
import { useEngine } from '@gwenjs/core'

const engine = useEngine()

// Add a component
engine.addComponent(entityId, Position, { x: 10, y: 20 })

// Remove a component
engine.removeComponent(entityId, Velocity)
```

**Note:** Adding/removing components is relatively expensive (reallocates buffers), so do it sparingly, not every frame.

## Deep Dive

### Structure-of-Arrays Layout

GWEN stores components in **Structure-of-Arrays** (SoA) format in WASM memory. This is different from a typical object-oriented approach.

**Object-Oriented (Inefficient):**
```
Entity 0: { x: 10, y: 20, vx: 1, vy: 0, health: 100 }
Entity 1: { x: 30, y: 40, vx: 2, vy: 1, health: 80 }
Entity 2: { x: 50, y: 60, vx: 1, vy: 1, health: 60 }
// Bad: different data types mixed; poor cache locality
```

**Structure-of-Arrays (Efficient):**
```
Position.x:  [10, 30, 50, ...]
Position.y:  [20, 40, 60, ...]
Velocity.x:  [1,  2,  1,  ...]
Velocity.y:  [0,  1,  1,  ...]
Health:      [100, 80, 60, ...]
// Good: homogeneous arrays; great cache locality
```

When a system iterates over entities and reads `Position.x[id]`, it's accessing a contiguous array. The CPU's cache loads several values at once. This is why ECS is faster than OOP for game logic.

### TypedArray Views

Component fields are JavaScript `TypedArray` objects pointing directly at WASM linear memory:

```ts
const pos = Position.x
// pos is a Float32Array backed by SharedArrayBuffer
console.log(pos[0])     // Read first entity's X position
pos[0] = 100            // Write directly to WASM memory (no overhead)
```

There's no serialization, no copying, no allocation. Just direct memory access.

### Memory Efficiency

Choosing the right types saves memory and improves performance:

- Health is at most 999? Use `Types.i16` instead of `Types.i32` (half the memory)
- Rotation only needs 0–360? Use `Types.f32` instead of `Types.f64`
- Storing 1000 entities with position + health + armor:
  - `f32 + f32 + i32 + i32 + f32` = 20 bytes per entity = 20 KB total
  - Much better than JavaScript objects!

## API Summary

| Function | Description |
|---|---|
| `defineComponent(options)` | Declare a component with a typed schema |
| `Types.f32`, `Types.f64`, etc. | Type descriptors for schema fields |
| `Component.field[entityId]` | Read or write a component field |
| `engine.addComponent(id, Component, data)` | Add a component to a living entity |
| `engine.removeComponent(id, Component)` | Remove a component from an entity |

## Next Steps

- **[Systems](/essentials/systems)** — Write systems that read and write component data.
- **[Architecture](/essentials/architecture)** — Understand how components fit into GWEN's ECS.
- **[Scenes and Actors](/essentials/scenes)** — Learn how to spawn entities in scenes.
