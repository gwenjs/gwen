---
title: Components
description: Components are the data layer of GWEN's ECS. Learn to define and use them.
---

# Components

In GWEN's ECS, **components are pure data**. They hold typed fields but contain no logic or methods. Multiple components attach to the same entity to describe it completely.

::: info Import required
`defineComponent` and `Types` are not auto-imported — they are used when defining your component files, outside of any engine context. Always import them explicitly:
```ts
import { defineComponent, Types } from '@gwenjs/core'
```
:::

## The Basics

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

export const Health = defineComponent({
  name: 'Health',
  schema: {
    current: Types.i32,
    max: Types.i32,
  },
})
```

Each field is stored as a contiguous typed array in WASM memory. Entities are the index:

```ts
// Inside a system — entity.id is a bigint
Position.x[entity.id] = 100
Position.y[entity.id] = 200
```

`defineComponent` throws `GwenError` with code `CORE:COMPONENT_TYPE_LIMIT_REACHED` when a new name would pass the limit. The limit is 128 types. One type is reserved for the transform column, so 127 distinct user names fit. The limit counts distinct names defined in the process. Defining the same name again with the same fields is accepted (hot reload) and keeps the type id in each engine. Type ids are per engine: each engine assigns one the first time it sees a name, so two engines can give the same component different ids. With other fields, field order or field types it throws `GwenError` with code `CORE:INVALID_COMPONENT_SCHEMA`. The check runs at definition time and does not call WASM. One layout per component name in the whole process: two engines in one page cannot define the same name with different fields, and a hot reload that changes the fields throws `CORE:INVALID_COMPONENT_SCHEMA`.

## Available Types

| Type | TypeScript | Description |
|---|---|---|
| `Types.f32` | `number` | 32-bit float — positions, rotations, scales |
| `Types.f64` | `number` | 64-bit float — high-precision math |
| `Types.i32` | `number` | Signed 32-bit integer — health, counters, IDs |
| `Types.i64` | `bigint` | Signed 64-bit integer — large counters |
| `Types.u32` | `number` | Unsigned 32-bit integer — timers, indices |
| `Types.u64` | `bigint` | Unsigned 64-bit integer — large unsigned values |
| `Types.bool` | `boolean` | Boolean flag |
| `Types.string` | `string` | Interned string — use sparingly, not for hot paths |

Choose types carefully: smaller types use less memory and improve cache efficiency.

## Tag Components

A tag component has an empty schema — it marks an entity without storing data:

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

## Default Values

Use `defaults` to declare initial values for each field. These are applied when a prefab spawns an entity without an explicit override:

```ts
export const Health = defineComponent({
  name: 'Health',
  schema: {
    current: Types.i32,
    max: Types.i32,
  },
  defaults: {
    current: 100,
    max: 100,
  },
})
```

::: tip Prefab overrides take priority
When a prefab declares its own `defaults`, they override the component's `defaults`. Both are overridden by values passed to `spawn()`.
:::

## Reading Component Data in a System

Systems iterate over a `LiveQuery<EntityAccessor>`. Each entity has `.id` (bigint) for direct SoA access:

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

You can also read a component as a plain object using `entity.get(def)`:

```ts
onUpdate(() => {
  for (const entity of entities) {
    const pos = entity.get(Position) // { x: number, y: number } | undefined
  }
})
```

## Reading Component Data in an Actor

Inside a `defineActor` factory, use `useComponent()` to get a live reactive proxy:

```ts
import { Health } from './components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.current <= 0) {
      // handle death
    }
  })
})
```

::: warning Actor context only
`useComponent()` only works inside `defineActor`. In systems, use `entity.get(def)` or direct SoA access (`Component.field[entity.id]`) instead.
:::

See [Actors](/essentials/actors) for full documentation of `useComponent`.

## Re-exporting Components

Use a barrel file so that imports stay clean across your project:

```ts
// src/components/index.ts
export * from './Position'
export * from './Velocity'
export * from './Health'
```

## Structure-of-Arrays Layout

GWEN stores components in **Structure-of-Arrays** (SoA) format in WASM memory:

```
Position.x:  [10, 30, 50, ...]    ← contiguous Float32Array
Position.y:  [20, 40, 60, ...]
Velocity.x:  [1,  2,  1,  ...]
Health.current: [100, 80, 60, ...]
```

When a system iterates and reads `Position.x[entity.id]`, the CPU loads several values at once from a contiguous array. This is why ECS is faster than storing objects per entity.

## API Summary

| | |
|---|---|
| `defineComponent({ name, schema, defaults? })` | Declare a component type |
| `Types.f32 / f64 / i32 / i64 / u32 / u64 / bool / string` | Field type descriptors |
| `Component.field[entity.id]` | Read or write a component field (in a system) |
| `useComponent(def)` | Reactive component proxy inside `defineActor` |

## Next Steps

- **[Systems](/essentials/systems)** — Write systems that read and write component data.
- **[Actors](/essentials/actors)** — Use `useComponent()` for reactive component access inside actors.
- **[Prefabs](/essentials/prefabs)** — Bundle components into reusable spawn templates.
