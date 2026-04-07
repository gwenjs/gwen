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
  { def: Velocity, defaults: { x: 5, y: 0 } },
  { def: Damage, defaults: { value: 10 } },
])
```

### Spawning from a Prefab

Use `usePrefab()` to get a handle for spawning and despawning entities:

```ts
import { usePrefab } from '@gwenjs/core/actor'
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { BulletPrefab } from './prefabs'

export const FireSystem = defineSystem(() => {
  const bullet = usePrefab(BulletPrefab)

  onUpdate(() => {
    if (shouldFire) {
      // Spawn a bullet at the player's position
      const id = bullet.spawn({
        x: playerX,
        y: playerY,
      })
    }
  })
})
```

`usePrefab()` returns a `PrefabHandle` with two methods:
- `spawn(overrides?)` — Create an entity, returns its ID
- `despawn(id)` — Destroy an entity by ID

The returned entity ID is a `bigint` you can use to track and despawn entities later:

```ts
const bulletId = bullet.spawn({
  x: 100,
  y: 50,
})

// Later, despawn the bullet
bullet.despawn(bulletId)
```

### Partial Overrides

When spawning, you only need to override fields you care about. Defaults fill in the rest:

```ts
// Uses default damage (10), custom position and velocity
const id = bullet.spawn({
  x: 200,
  y: 300,
})

// Uses all defaults except position
const id = bullet.spawn({
  x: 100,
  y: 100,
})
```

## In Practice

### Enemy Prefab with Multiple Components

Here's a realistic prefab for enemies in a shooter:

```ts
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Health, AI } from './components'

export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { current: 50, max: 50 } },
  { def: AI, defaults: { state: 0 } }, // State 0 = patrolling
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
