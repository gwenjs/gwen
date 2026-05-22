---
title: Performance Patterns
description: Three critical patterns for writing performant GWEN games — hybrid actor/system architecture, shared code, and the build-time ECS optimizer.
---

# Performance Patterns

GWEN is designed so that **idiomatic code is fast code**. The build-time Vite optimizer and the
ECS architecture handle the heavy lifting. But three patterns determine whether your game scales
or stalls at 100+ entities.

## 1. Hybrid Actor / System Architecture

### The trap

Coming from React or Vue, the instinct is to put all logic inside actors — they look like
`<script setup>` and feel natural. For unique objects (player, boss, HUD) that is the right
call. For bulk entities it is not.

```ts
// ❌ 500 enemies — 500 separate onUpdate callbacks, no ECS gain
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const transform = useTransform()

  onUpdate((dt) => {
    transform.x += 100 * dt   // one callback per entity, cache-unfriendly
  })
})
```

Each actor runs its own `onUpdate`. Five hundred enemies means five hundred independent
callbacks — the engine cannot batch them, and cache locality is lost.

### The pattern

Use actors for **identity** (spawn, configuration, public API). Use systems for **bulk logic**
(movement, AI sweeps, collision response).

```ts
// ✅ Actor — owns the entity and exposes the API
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const speed = useComponent(self.id, Enemy)

  return {
    setSpeed(v: number) { speed.value = v },
  }
})

// ✅ System — processes all enemies in one pass
export const EnemyMovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Enemy])

  onUpdate((dt) => {
    for (const entity of entities) {
      const pos = useComponent(entity.id, Position)
      const enemy = useComponent(entity.id, Enemy)
      pos.x += enemy.speed * dt
    }
  })
})
```

| Use actor when | Use system when |
|---|---|
| One unique object (player, camera, HUD) | Many identical objects (enemies, bullets, particles) |
| You need a named public API | You need a single pass over N entities |
| State is instance-specific | Logic is the same for every entity |

### Wiring them in a scene

```ts
export const GameScene = defineScene('game', () => {
  useSystem(EnemyMovementSystem)

  const enemies = useActor(EnemyActor)
  onEnter(() => {
    for (let i = 0; i < 500; i++) enemies.spawn()
  })
})
```

The system iterates all entities in one contiguous pass. Actors spawn/despawn them. Neither
knows about the other.

---

## 2. Shared Code Between System and Actor

### The trap

A system processes entities in bulk; an actor owns one. When both need the same logic (e.g.
computing a damage value), the reflex is to duplicate the code or reach for a class hierarchy.

### Pattern A — Pure functions

Extract the logic into a plain function with no ECS dependency. Both the actor and the system
call it.

```ts
// shared/damage.ts — no ECS, no composables, just data in data out
export function computeDamage(base: number, multiplier: number, armor: number): number {
  return Math.max(0, base * multiplier - armor)
}

// In system — bulk pass
onUpdate(() => {
  for (const entity of entities) {
    const stats = useComponent(entity.id, Stats)
    stats.hp -= computeDamage(stats.attack, 1.2, stats.armor)
  }
})

// In actor — single entity
const damage = computeDamage(myStats.attack, comboMultiplier, targetArmor)
```

Pure functions are cache-friendly, trivially testable, and have zero GWEN dependency.

### Pattern B — Shared service via `useService`

When the shared state is runtime (not pure computation), register it as a service in a plugin
and consume it from both sides.

```ts
// Plugin registers the service
definePlugin({
  setup(engine) {
    const scoreBoard = createScoreBoard()
    engine.provide('scoreBoard', scoreBoard)
  }
})

// System reads it
export const ScoreSystem = defineSystem(() => {
  const board = useService('scoreBoard')
  onUpdate(() => { /* update board from entity data */ })
})

// Actor reads it too
export const HUDActor = defineActor(HUDPrefab, () => {
  const board = useService('scoreBoard')
  onUpdate(() => { renderScore(board.total) })
})
```

`useService` resolves once at setup time — zero overhead in `onUpdate`.

---

## 3. Build-Time ECS Optimizer

### How it works

GWEN's Vite plugin scans your systems at build time and transforms the ergonomic
`useComponent` proxy pattern into bulk WASM calls — automatically, without any change to
your code.

**You write:**

```ts
export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const entity of entities) {
      const pos = useComponent(entity.id, Position)
      const vel = useComponent(entity.id, Velocity)
      pos.x += vel.x * dt
      pos.y += vel.y * dt
    }
  })
})
```

**The optimizer produces:**

```ts
// queryReadBulk: one WASM call to load all Position + Velocity data into typed arrays
const { entityCount: _count_position, data: _position, slots: _slots, gens: _gens } =
  __gwen_bridge__.queryReadBulk([1, 2], 1, 2);
const { data: _velocity } =
  __gwen_bridge__.queryReadBulk([1, 2], 2, 2);

for (let _i = 0; _i < _count_position; _i++) {
  _position[_i * 2 + 0] += _velocity[_i * 2 + 0] * dt   // pos.x += vel.x * dt
  _position[_i * 2 + 1] += _velocity[_i * 2 + 1] * dt   // pos.y += vel.y * dt
}

// queryWriteBulk: one WASM call to flush all mutations back
__gwen_bridge__.queryWriteBulk(_slots, _gens, 1, _position);
```

N entities, 2 fields each → **2 WASM calls total** instead of N × field-count individual calls.
The gain becomes measurable at ~100+ entities.

### What the optimizer detects

The optimizer recognises this exact shape inside a `defineSystem` factory:

```ts
const entities = useQuery([ComponentA, ComponentB])   // literal array of identifiers

onUpdate((dt) => {
  for (const entity of entities) {
    const a = useComponent(entity.id, ComponentA)     // 2-arg read
    const b = useComponent(entity.id, ComponentB)     // 2-arg read
    a.field += b.field * dt                           // proxy mutation → write target
  }
})
```

Constraints — the optimizer skips a pattern when:

| Constraint | Reason |
|---|---|
| All component fields must be numeric (`f32`, `i32`, `u32`, …) | Bulk WASM buffers are typed arrays |
| Only one `for-of` loop per `onUpdate` | Multi-loop systems are not yet merged |
| All components must be in the build-time manifest | The scanner reads `defineComponent` from `src/` |
| `useQuery` array must be a literal of identifiers | Dynamic arrays cannot be pre-computed |

### Enabling the optimizer

```ts
// vite.config.ts  (or gwen.config.ts → vite field)
import { gwenVitePlugin, gwenOptimizerPlugin } from '@gwenjs/vite'

export default {
  plugins: [
    gwenVitePlugin(),
    gwenOptimizerPlugin({ mode: 'transform' }),  // 'detect' to audit, 'transform' to rewrite
  ]
}
```

Use `mode: 'detect'` first to see which systems are optimizable before enabling rewrites.

### Hot path rules

Regardless of whether the optimizer applies, follow these rules inside `onUpdate`:

```ts
onUpdate((dt) => {
  for (const entity of entities) {
    // ✅ useComponent proxy — ergonomic and optimizable
    const pos = useComponent(entity.id, Position)
    pos.x += vel.x * dt

    // ❌ addComponent / removeComponent — archetype change, buffer reallocation
    // engine.addComponent(entity.id, NewTag, {})

    // ❌ async — engine context is lost after await, onUpdate is synchronous
    // await fetch('/api/state')

    // ❌ new object allocations per entity — GC pressure
    // const v = new Vec2(pos.x, pos.y)   use @gwenjs/math allocation-free helpers instead
  }
})
```

## Summary

| Pattern | Rule |
|---|---|
| Many entities | System, not actor |
| Shared pure logic | Plain function, no ECS dependency |
| Shared runtime state | `engine.provide` / `useService` |
| Bulk iteration | `useComponent(entity.id, Def)` proxy — optimizer handles the rest |
| In `onUpdate` | No `addComponent`, no `async`, no `new` allocations |
