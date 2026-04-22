---
title: Prefabs
description: Prefabs define the component layout for an entity. They are the data blueprint that actors build on.
---

# Prefabs

A **prefab** defines the component layout for an entity — which components it has and their initial values. The typical use is as the first argument to `defineActor`: the prefab declares the data shape, the actor adds lifecycle hooks and a public API.

::: info Auto-imports
In a GWEN project, `definePrefab` and `usePrefab` are auto-imported — no `import` statement needed.
:::

## Defining a Prefab

Use `definePrefab()` to declare a reusable entity template:

```ts
import { Position, Velocity, Health } from './components'

export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { vx: 0, vy: 0 } },
  { def: Health,   defaults: { current: 50, max: 50 } },
])
```

:::tip Field names matter
`spawn()` overrides are a **flat** merge applied to all components. If two components share a field name (e.g. both have `x`), a single override hits both. Use distinct field names across components — `x`/`y` for position, `vx`/`vy` for velocity — to keep overrides unambiguous.
:::

## Using a Prefab in an Actor

Pass the prefab as the first argument to `defineActor`. The actor gets lifecycle hooks, a public API, and full spawn/despawn control — this is the standard way to bring a prefab to life:

```ts
import { EnemyPrefab } from './prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { x: number; y: number }) => {
  const health = useComponent(Health)

  onStart(() => {
    useTransform().setPosition(props.x, props.y)
  })

  onUpdate(() => {
    // movement, AI, etc.
  })

  return {
    takeDamage: (n: number) => { health.current -= n },
    getHp: () => health.current,
  }
})
```

Then in a scene, spawn instances through the actor handle:

```ts
export const GameScene = defineScene('game', () => {
  const enemy = useActor(EnemyActor)

  onEnter(() => {
    enemy.spawn({ x: 400, y: 300 })
    enemy.spawn({ x: 600, y: 200 })
  })

  onExit(() => enemy.despawnAll())
})
```

See [Actors](/essentials/actors) for the full actor API.

## Spawn Overrides

When spawning, pass overrides to set field values for that instance. Overrides are **shallow-merged** into each component's defaults — only the fields you pass change:

```ts
// Position overridden, Health stays at defaults
enemy.spawn({ x: 200, y: 300 })

// Override position and give this enemy more health
enemy.spawn({ x: 100, y: 100, current: 100, max: 100 })

// Use every prefab default
enemy.spawn()
```

::: tip Component defaults vs prefab defaults
`defineComponent` accepts a `defaults` field for component-level fallbacks. Prefab `defaults` override those, and values passed to `spawn()` override everything. The priority chain is: `spawn()` args → prefab defaults → component defaults.
:::

## Direct Spawning with `usePrefab`

For entities that are pure data — no lifecycle, no public API, queried only by systems — you can use `usePrefab()` directly to get a low-level spawn handle:

```ts
import { ObstaclePrefab } from './prefabs'

// Inside an actor or system factory:
const obstacle = usePrefab(ObstaclePrefab)
const id = obstacle.spawn({ x: 100, y: 200 })
obstacle.despawn(id)
```

This is an escape hatch for cases like static map geometry or data seeds. **For anything with rendering, movement, or lifecycle, wrap it in an actor.**

## API Summary

| Function | Description |
|---|---|
| `definePrefab(components)` | Declare a component layout |
| `defineActor(prefab, factory)` | Wrap a prefab with lifecycle and public API — primary use |
| `usePrefab(PrefabDef)` | Low-level spawn handle (no lifecycle) |
| `handle.spawn(overrides?)` | Create an entity, returns entity ID |
| `handle.despawn(id)` | Remove a spawned entity |

## Next Steps

- **[Actors](/essentials/actors)** — Add lifecycle, update logic, and a public API to your prefab.
- **[Scenes](/essentials/scenes)** — Register and control actors from a scene.
- **[Systems](/essentials/systems)** — Write batch logic over all entities matching a prefab's components.
