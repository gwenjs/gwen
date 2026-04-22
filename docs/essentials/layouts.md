---
title: Layouts
description: Persistent UI layers that survive scene transitions — perfect for HUDs, menu bars, and global UI.
---

# Layouts

A **layout** is a persistent layer that lives above all scenes. Unlike scenes (which load and unload), a layout persists across scene transitions. Use layouts for HUDs, menu bars, pause dialogs, and any UI that should survive when you change scenes.

::: info Auto-imports
In a GWEN project, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, and `placePrefab` are auto-imported — no `import` statement needed.
:::

## Defining a Layout

Use `defineLayout()` to declare a persistent layer. Inside the factory, place actors with `placeActor()`, passing their initial position and props:

```ts
import { HUDActor } from './actors/hud'
import { MinimapActor } from './actors/minimap'

export const GameLayout = defineLayout(() => {
  const hud     = placeActor(HUDActor,     { at: [0, 0] })
  const minimap = placeActor(MinimapActor, { at: [700, 16] })
  return { hud, minimap }
})
```

The object returned by the factory becomes `layout.refs` — a typed record of `PlaceHandle` values, one per placed actor.

## PlaceHandle

`placeActor()` returns a `PlaceHandle` with direct access to the placed entity:

| Property / Method | Description |
|---|---|
| `handle.api` | The actor's public API (return value of the actor factory) |
| `handle.entityId` | The entity's `bigint` ID |
| `handle.moveTo([x, y])` | Reposition the entity in world space |
| `handle.despawn()` | Despawn this entity immediately |

```ts
const layout = useLayout(GameLayout, { lazy: true })
await layout.load()

// Call a method on the HUD actor
layout.refs.hud.api.setScore(100)

// Move the minimap
layout.refs.minimap.moveTo([680, 16])
```

## Placement Options

All `place*` composables accept a second argument with placement options:

| Option | Type | Description |
|---|---|---|
| `at` | `[x, y]` | Local position. Default `[0, 0]` |
| `rotation` | `number` | Local rotation in radians. Default `0` |
| `scale` | `number \| [sx, sy]` | Uniform or per-axis scale. Default `1` |
| `parent` | `PlaceHandle` | Parent handle — position is relative to parent |
| `props` | `object` | Props forwarded to the actor at spawn time |

```ts
export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, {
    at: [0, 0],
    props: { initialScore: 0 },
  })

  // Anchor group — children inherit its transform
  const topBar = placeGroup({ at: [0, 0] })
  const timer  = placeActor(TimerActor, { at: [400, 8], parent: topBar })

  return { hud, topBar, timer }
})
```

## Loading and Unloading

Use `useLayout(def, { lazy: true })` inside a scene to get a control handle without loading immediately. Call `await layout.load()` and `await layout.dispose()` to activate and deactivate:

```ts
export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout, { lazy: true })

  onEnter(async () => await layout.load())
  onExit(async () => await layout.dispose())
})
```

::: tip Without `lazy`, the layout loads immediately
`useLayout(GameLayout)` without `{ lazy: true }` calls `load()` automatically. Use `lazy: true` when you want explicit control over when the layout activates.
:::

`LayoutHandle` API:

| | |
|---|---|
| `layout.load()` | Activate — spawns all placed actors. Returns `Promise<void>` |
| `layout.dispose()` | Deactivate — despawns all placed actors. Returns `Promise<void>` |
| `layout.active` | `true` if the layout is currently loaded |
| `layout.refs` | Typed record of `PlaceHandle` values |

## Full Example — Game HUD

A HUD actor that updates score and health, placed in a layout that persists across scenes:

```ts
// src/actors/hud.ts
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'

export const HUDActor = defineActor(HUDPrefab, () => {
  const data = useComponent(HUDData)

  onUpdate(() => {
    renderHUD({ score: data.score, health: data.health })
  })

  return {
    setScore:  (n: number) => { data.score  = n },
    setHealth: (n: number) => { data.health = n },
  }
})

// src/layouts/game-layout.ts
import { HUDActor } from '../actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, { at: [0, 0] })
  return { hud }
})

// src/scenes/game-scene.ts
import { GameLayout } from '../layouts/game-layout'

export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout, { lazy: true })

  onEnter(async () => await layout.load())
  onExit(async ()  => await layout.dispose())
})

// Updating the HUD from another system — call via refs.api
layout.refs.hud.api.setScore(newScore)
```

## Layout vs Scene

| | Layout | Scene |
|---|---|---|
| **Persistence** | Survives scene transitions | Loads/unloads per scene |
| **Systems** | — | Run while the scene is active |
| **Actors** | Placed via `placeActor` | Registered via `useActor` |
| **Use case** | HUD, menu bars, global UI | Game states, level logic |

## API Summary

| | |
|---|---|
| `defineLayout(factory)` | Declare a persistent UI layer |
| `placeActor(def, options?)` | Place an actor — returns `PlaceHandle<API>` |
| `placeGroup(options?)` | Create a transform-only anchor entity — returns `PlaceHandle<void>` |
| `placePrefab(def, options?)` | Place a prefab entity — returns `PlaceHandle<void>` |
| `useLayout(def, options?)` | Get layout control handle (`{ lazy }` to defer load) |
| `layout.load()` | Activate the layout (`Promise<void>`) |
| `layout.dispose()` | Deactivate the layout (`Promise<void>`) |
| `layout.active` | `true` if layout is loaded |
| `layout.refs` | Typed record of placed handles |
| `handle.api` | Actor's public API |
| `handle.moveTo([x, y])` | Reposition the entity |
| `handle.despawn()` | Despawn this entity |

## Next Steps

- **[Scenes](/essentials/scenes)** — How scenes work alongside layouts.
- **[Actors](/essentials/actors)** — Build the UI actors placed in your layout.
- **[Prefabs](/essentials/prefabs)** — Define the component layout for your actors.
