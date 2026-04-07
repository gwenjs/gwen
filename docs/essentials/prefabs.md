---
title: Prefabs
description: Prefabs are reusable entity blueprints that let you spawn multiple entities with the same components and initial values.
---

# Prefabs

A **prefab** is a reusable template for spawning entities. Instead of manually spawning the same combination of components and defaults over and over, define a prefab once and spawn it many times. Prefabs are essential for spawning bullets, enemies, collectibles, and other repeated elements in your game.

## The Basics

### Defining a Prefab

Use `definePrefab()` to declare a reusable entity template:

```ts
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Damage } from './components'

export const BulletPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { vx: 5, vy: 0 } },
  { def: Damage,   defaults: { value: 10 } },
])
```

:::tip Field names matter
`spawn()` overrides are a **flat** merge applied to all components. If two components share a field name (e.g. both have `x`), a single override hits both. Use distinct field names across components — `x`/`y` for position, `vx`/`vy` for velocity — to keep overrides unambiguous.
:::

### Spawning from a Prefab

Use `usePrefab()` to get a handle for spawning and despawning entities:

```ts
import { usePrefab } from '@gwenjs/core/actor'
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { BulletPrefab } from './prefabs'

export const FireSystem = defineSystem(function FireSystem() {
  const bullet = usePrefab(BulletPrefab)

  onUpdate(() => {
    if (shouldFire) {
      // Override Position.x/y at spawn — Velocity.vx/vy use their defaults
      const id = bullet.spawn({ x: playerX, y: playerY })
    }
  })
})
```

`usePrefab()` returns a `PrefabHandle` with two methods:
- `spawn(overrides?)` — Create an entity, returns its ID as `bigint`
- `despawn(id)` — Destroy an entity by ID

```ts
// Spawn at a specific position; velocity and damage use prefab defaults
const bulletId = bullet.spawn({ x: 100, y: 50 })

// Later, despawn the bullet
bullet.despawn(bulletId)
```

### Partial Overrides

Overrides are **shallow-merged** into each component's defaults. Only fields you pass are changed; the rest keep their declared defaults:

```ts
// Position overridden, Velocity.vx/vy and Damage.value stay at defaults
const id = bullet.spawn({ x: 200, y: 300 })

// Override both position and velocity direction
const id = bullet.spawn({ x: 100, y: 100, vx: -5 })

// Use every default — spawn at origin moving right, 10 damage
const id = bullet.spawn()
```

## In Practice

### Enemy Prefab with Multiple Components

Here's a realistic prefab for enemies in a shooter:

```ts
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Health, AI } from './components'

export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { vx: 0, vy: 0 } },
  { def: Health,   defaults: { current: 50, max: 50 } },
  { def: AI,       defaults: { state: 0 } }, // State 0 = patrolling
])
```

In your spawning system:

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { usePrefab } from '@gwenjs/core/actor'
import { EnemyPrefab } from './prefabs'

export const EnemySpawnerSystem = defineSystem(() => {
  const enemy = usePrefab(EnemyPrefab)

  onUpdate(() => {
    // Spawn enemies at random locations
    for (let i = 0; i < enemiesToSpawn; i++) {
      enemy.spawn({
        x: Math.random() * 800,
        y: Math.random() * 600,
      })
    }
  })
})
```

### Prefabs vs Actors

**Prefabs** are for spawning many similar entities (bullets, enemies, coins). **Actors** are for unique, named entities (the player, a boss, a UI panel).

- **Use a prefab** if: You spawn 0 to many of these entities during gameplay
- **Use an actor** if: Exactly one instance exists, or it has special lifecycle handling (like the player or main menu)

See [Scenes and Actors](/essentials/scenes) to learn about actors.

## API Summary

| Function | Description |
|---|---|
| `definePrefab(components)` | Declare a reusable entity template with array syntax |
| `usePrefab(PrefabDef)` | Get a handle for a prefab instance |
| `handle.spawn(overrides?)` | Create an entity from the prefab, returns entity ID |
| `handle.despawn(id)` | Remove an entity spawned from the prefab |

## Next Steps

- **[Scenes and Actors](/essentials/scenes)** — Learn how actors complement prefabs for unique entities.
- **[Layouts](/essentials/layouts)** — Persist UI across multiple scenes using layouts.
- **[Systems](/essentials/systems)** — Write systems that interact with spawned entities.
