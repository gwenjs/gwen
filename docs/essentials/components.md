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

Numeric fields are contiguous typed arrays inside one chunk. The index is the row in that chunk, not the entity id. See [Storage model](#storage-model).

`defineComponent` throws `GwenError` with code `CORE:INVALID_COMPONENT_SCHEMA` when a field is not a `SchemaType`. It does not throw for a second layout of a known name, and it does not throw for the 129th name. Each engine assigns the id and checks the 128-name budget the first time it uses a name. The 129th name throws `GwenError` with code `CORE:COMPONENT_TYPE_LIMIT_REACHED`. A later use with other lane bytes throws `GwenError` with code `CORE:COMPONENT_LAYOUT_INVALID`. Defining the same name again with the same lanes keeps the type id in that engine. Type ids are per engine: each engine assigns one the first time it sees a name, so two engines can give the same component different ids. Two engines can use one name with different lanes. Lane bytes are the scalar lanes in field order, with `vec2` / `vec3` / `vec4` / `quat` / `color` counting as 2 / 3 / 4 / 4 / 4 f32 lanes. A renamed field, a reorder of fields with the same lanes, `vec2` in place of two `f32`, or `Types.string` in place of `Types.persistentString` keeps the same lanes: the engine accepts it and reuses the id. Same lanes reuse that id and keep the bytes from the first use: a reordered field does not swap stored values, and `Types.persistentString` after `Types.string` still writes the string id into the scene pool.

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

`useQuery` returns a `Query`. Iterate chunks, then rows:

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { x: Types.f32, y: Types.f32 },
});

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      const vel = chunk.get(Velocity);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (vel.x[row] ?? 0) * dt;
        pos.y[row] = (pos.y[row] ?? 0) + (vel.y[row] ?? 0) * dt;
      }
    }
  });
});
```

`query.each()` walks one entity at a time. `entity.get(Def)` returns a snapshot. That path is for single-entity work. During an update phase it logs code `CORE:QUERY_PER_ENTITY_PATH`.

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
`useComponent()` only works inside `defineActor`. In systems, iterate the query by chunk.
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

## Storage model

A chunk is one archetype. Every entity in that chunk has the same components, and those components share the row index. Row order is not the entity id.

`chunk.get(Def)` returns the live columns for that component in that chunk. `f32` is a `Float32Array`, `f64` a `Float64Array`, `i32` an `Int32Array`, `u32` a `Uint32Array`, and `bool` a `Uint8Array`. `vec2` is `{ x, y }`, `vec3` is `{ x, y, z }`, `vec4` and `quat` are `{ x, y, z, w }`, and `color` is `{ r, g, b, a }`. `Types.string`, `Types.i64`, and `Types.u64` are absent: reading them on the chunk is a type error. `engine.getComponent` still returns those fields in a snapshot.

`chunk.entityId(row)` is the entity at that row. `chunk.count` is the row count. The chunk handle is invalid once the iterator moves on.

After WASM memory grows, a typed-array view taken earlier is detached. Call `chunk.get(Def)` again. Field views are tracked in #74.

Adding a component that is not already on the entity writes the defaults, then the keys you pass. Adding it again patches only those keys. Removing it drops that component's row. Inside an open `for (const chunk of query)` loop, add, remove, and destroy wait until that loop closes.

```ts run
import assert from "node:assert/strict";
import { defineComponent, Types } from "@gwenjs/core";
import { useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsStorageDestroyPos",
  schema: { x: Types.f32 },
  defaults: { x: 1 },
});

const id = engine.createEntity();
engine.addComponent(id, Position, { x: 1 });
const query = engine.run(() => useQuery([Position]));
let aliveDuring = false;
for (const _chunk of query) {
  engine.destroyEntity(id);
  aliveDuring = engine.isAlive(id);
}
assert.equal(aliveDuring, true);
assert.equal(engine.isAlive(id), false);
```

`query.each()` is the per-entity path. During `onBeforeUpdate`, `onUpdate`, and `onAfterUpdate` it logs code `CORE:QUERY_PER_ENTITY_PATH`. The message names the API and says to iterate the query by chunk. Deprecated: `useComponentFor` is the other per-entity call and logs the same code. Deprecated: `createLiveQuery` does not log that warning.

## API Summary

| | |
|---|---|
| `defineComponent({ name, schema, defaults? })` | Declare a component type |
| `Types.f32 / f64 / i32 / i64 / u32 / u64 / bool / string` | Field type descriptors |
| `chunk.get(Def).field[row]` | Live column inside a chunk loop |
| `useComponent(def)` | Component proxy inside `defineActor` |

## Next Steps

- **[Systems](/essentials/systems)** — Write systems that read and write component data.
- **[Actors](/essentials/actors)** — Use `useComponent()` for reactive component access inside actors.
- **[Prefabs](/essentials/prefabs)** — Bundle components into reusable spawn templates.
