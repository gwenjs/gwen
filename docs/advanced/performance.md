---
title: Performance Patterns
description: Chunk loops for bulk work, shared functions, and the optimizer the framework installs.
---

# Performance Patterns

Use an actor for one named object. Use a system chunk loop when the same logic applies to many entities. The framework owns the Vite config and installs the optimizer.

## 1. Hybrid actor / system architecture

### The trap

An actor `onUpdate` runs once per instance. Many actors means many callbacks.

```ts
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const transform = useTransform()

  onUpdate((dt) => {
    transform.x += speed * dt
  })
})
```

### The pattern

The actor owns the entity and the public API. `useComponent(def)` takes the component definition and is called in the actor factory. The system walks chunks.

```ts
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const enemy = useComponent(Enemy)

  return {
    setSpeed(v: number) { enemy.speed = v },
  }
})

export const EnemyMovementSystem = defineSystem(() => {
  const query = useQuery([Position, Enemy])

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position)
      const enemy = chunk.get(Enemy)
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (enemy.speed[row] ?? 0) * dt
      }
    }
  })
})
```

| Use an actor when | Use a system when |
|---|---|
| One unique object (player, camera, HUD) | Many identical objects (enemies, bullets, particles) |
| You need a named public API | You need one pass over the entities |
| State is instance-specific | Logic is the same for every entity |

### Wiring them in a scene

```ts
export const GameScene = defineScene('game', () => {
  useSystem(EnemyMovementSystem)

  const enemies = useActor(EnemyActor)
  onEnter(() => {
    enemies.spawn()
  })
})
```

The system walks the entities. The actor spawns them.

## 2. Shared code between a system and an actor

### Pattern A — pure functions

```ts
export function computeDamage(base: number, multiplier: number, armor: number): number {
  return Math.max(0, base * multiplier - armor)
}

onUpdate(() => {
  for (const chunk of query) {
    const stats = chunk.get(Stats)
    for (let row = 0; row < chunk.count; row += 1) {
      const next = computeDamage(stats.attack[row] ?? 0, 1.2, stats.armor[row] ?? 0)
      stats.hp[row] = (stats.hp[row] ?? 0) - next
    }
  }
})

const damage = computeDamage(myStats.attack, comboMultiplier, targetArmor)
```

### Pattern B — `useService`

Call `useService` in the factory. It returns the value registered with `engine.provide`.

```ts
definePlugin({
  setup(engine) {
    engine.provide('scoreBoard', createScoreBoard())
  }
})

export const ScoreSystem = defineSystem(() => {
  const board = useService('scoreBoard')
  onUpdate(() => { /* read entity columns, then update board */ })
})

export const HUDActor = defineActor(HUDPrefab, () => {
  const board = useService('scoreBoard')
  onUpdate(() => { renderScore(board.total) })
})
```

## 3. The chunk loop

`useQuery` returns a `Query`. `for (const chunk of query)` yields one archetype at a time. `chunk.get(Def)` returns the live columns for that chunk. The index is the row, not the entity id. `Types.string`, `Types.i64`, and `Types.u64` are absent from those columns.

Adding a component that is not already on the entity writes the defaults, then the keys you pass. Adding it again patches only those keys. Removing it drops that component's row. Inside an open chunk loop, add, remove, and destroy wait until the loop closes.

`query.each()` is the per-entity path. During an update phase it logs `CORE:QUERY_PER_ENTITY_PATH`.

A write in one system's chunk loop is visible to a later system in the same frame:

```ts run
import assert from "node:assert/strict";
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsPerfChunkPos",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const id = engine.createEntity();
engine.addComponent(id, Position, { x: 1 });

await engine.use(
  defineSystem("docs-perf-writer", () => {
    const query = useQuery([Position]);
    onUpdate(() => {
      for (const chunk of query) {
        const pos = chunk.get(Position);
        for (let row = 0; row < chunk.count; row += 1) pos.x[row] = 11;
      }
    });
  })(),
);

let readBack = 0;
await engine.use(
  defineSystem("docs-perf-reader", () => {
    const query = useQuery([Position]);
    onUpdate(() => {
      for (const chunk of query) {
        const pos = chunk.get(Position);
        readBack = pos.x[0] ?? 0;
      }
    });
  })(),
);

await engine.startExternal();
await engine.advance(0.016);
assert.equal(readBack, 11);
```

## 4. The optimizer the framework installs

A game does not ship a `vite` config file and does not call the optimizer plugin itself. `gwenVitePlugin` always installs it. The `optimizer` option maps to `mode`:

| `optimizer` | Result |
|---|---|
| omitted or `false` | `{ mode: "detect" }` |
| `true` | `{ mode: "transform" }` |
| an options object | `{ mode: "transform" }`, plus `componentsDir`, `tier`, and `debug` when set |

Deprecated: `useComponentFor` is the call the optimizer matches. Write the chunk loop in section 3. Rewriting that loop is a separate change.

## Hot path

Inside `onUpdate`:

- Read and write columns in the chunk loop.
- Do not `await`. The callback is synchronous.
- Structural add, remove, and destroy inside an open chunk loop wait until the loop closes.
- Do not construct an object on each row.

## Summary

| Pattern | Rule |
|---|---|
| Many entities | A system chunk loop |
| Shared pure logic | A plain function |
| Shared runtime state | `engine.provide` and `useService` in the factory |
| Bulk iteration | `for (const chunk of query)` and `chunk.get(Def)` |
| In `onUpdate` | No `await`. Structural changes in an open chunk loop wait until it closes. |
