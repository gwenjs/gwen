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
import { definePrefab, Types } from '@gwenjs/core'
import { Position, Velocity, Damage } from './components'

export const BulletPrefab = definePrefab({
  name: 'Bullet',
  components: [Position, Velocity, Damage],
  defaults: {
    [Position.name]: { x: 0, y: 0 },
    [Velocity.name]: { x: 5, y: 0 },
    [Damage.name]: { value: 10 },
  },
})
```

### Spawning from a Prefab

Use `usePrefab()` to get a spawn function. Call it to create entities:

```ts
import { usePrefab, useEngine } from '@gwenjs/core'

const spawnBullet = usePrefab(BulletPrefab)

onUpdate(() => {
  if (shouldFire) {
    // Spawn a bullet at the player's position
    spawnBullet({
      [Position.name]: { x: playerX, y: playerY },
      [Velocity.name]: { x: 10, y: 0 },
    })
  }
})
```

The function returns the entity ID of the newly spawned entity:

```ts
const bulletId = spawnBullet({
  [Position.name]: { x: 100, y: 50 },
})
```

### Partial Overrides

When spawning, you only need to override fields you care about. Defaults fill in the rest:

```ts
// Uses default damage (10), custom position and velocity
spawnBullet({
  [Position.name]: { x: 200, y: 300 },
  [Velocity.name]: { x: -5, y: 2 },
})

// Uses all defaults except position
spawnBullet({
  [Position.name]: { x: 100, y: 100 },
})
```

## In Practice

### Enemy Prefab with Multiple Components

Here's a realistic prefab for enemies in a shooter:

```ts
import { definePrefab, Types } from '@gwenjs/core'
import { Position, Velocity, Health, AI } from './components'

export const EnemyPrefab = definePrefab({
  name: 'Enemy',
  components: [Position, Velocity, Health, AI],
  defaults: {
    [Position.name]: { x: 0, y: 0 },
    [Velocity.name]: { x: 0, y: 0 },
    [Health.name]: { current: 50, max: 50 },
    [AI.name]: { state: 0 }, // State 0 = patrolling
  },
})
```

In your spawning system:

```ts
import { defineSystem, useQuery, onUpdate, usePrefab } from '@gwenjs/core'
import { EnemyPrefab } from './prefabs'
import { Position } from './components'

export const EnemySpawnerSystem = defineSystem(() => {
  const spawn = usePrefab(EnemyPrefab)

  onUpdate(() => {
    // Spawn enemies at random locations
    for (let i = 0; i < enemiesToSpawn; i++) {
      spawn({
        [Position.name]: {
          x: Math.random() * 800,
          y: Math.random() * 600,
        },
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
| `definePrefab(options)` | Declare a reusable entity template |
| `usePrefab(PrefabDef)` | Get a spawn function for a prefab instance |
| `spawn(components)` | Call the returned function to create an entity |

## Next Steps

- **[Scenes and Actors](/essentials/scenes)** — Learn how actors complement prefabs for unique entities.
- **[Layouts](/essentials/layouts)** — Persist UI across multiple scenes using layouts.
- **[Systems](/essentials/systems)** — Write systems that interact with spawned entities.
