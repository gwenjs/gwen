---
title: Layouts
description: Persistent UI layers that survive scene transitions — perfect for HUDs, menu bars, and global UI.
---

# Layouts

A **layout** is a persistent layer that lives above all scenes. Unlike scenes (which load and unload), a layout persists across scene transitions. Use layouts for HUDs, menu bars, pause dialogs, and any UI that should survive when you change scenes.

::: info Auto-imports
`defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab` are auto-imported in a GWEN project.
:::

## The Basics

Use `defineLayout()` to declare a persistent layer. Inside the factory, place actors using `placeActor()`:

```ts
import { defineLayout, placeActor } from '@gwenjs/core/actor'
import { HUDActor } from './actors/hud'
import { MinimapActor } from './actors/minimap'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  const minimap = placeActor(MinimapActor)
  return { hud, minimap }
})
```

The returned object becomes `layout.refs` — handles for each placed actor.

## Loading and Unloading

Use `useLayout(def)` inside a system or scene to get a control handle:

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useLayout } from '@gwenjs/core/actor'
import { GameLayout } from './layouts'

export const LayoutSystem = defineSystem(() => {
  const layout = useLayout(GameLayout)

  onEnter(() => layout.load())
  onExit(() => layout.dispose())
})
```

Or from a scene:

```ts
import { defineScene, onEnter, onExit } from '@gwenjs/core/scene'
import { useLayout } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout)

  onEnter(() => layout.load())
  onExit(() => layout.dispose())
})
```

`LayoutHandle` API:

| | |
|---|---|
| `layout.load()` | Activate the layout — spawns all placed actors |
| `layout.dispose()` | Deactivate — despawns all placed actors |
| `layout.active` | `true` if the layout is loaded |
| `layout.refs` | Object with each placed actor's handle |

## Placing Multiple Actors

Use `placeGroup()` to place several actors together:

```ts
export const GameLayout = defineLayout(() => {
  const ui = placeGroup([HUDActor, MinimapActor, ChatActor])
  return { ui }
})
```

Use `placePrefab()` to place a prefab entity (not an actor) in the layout:

```ts
export const GameLayout = defineLayout(() => {
  const cursor = placePrefab(CursorPrefab)
  return { cursor }
})
```

## Accessing Placed Actors

`layout.refs` exposes the handles returned by `placeActor()`:

```ts
const layout = useLayout(GameLayout)

// Access HUD actor handle
const hud = layout.refs.hud

// Call methods on the HUD
hud.get()?.updateScore(100)
```

## HUD Example

A realistic HUD that stays alive across scenes:

```ts
// src/actors/hud.ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core/actor'
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'

export const HUDActor = defineActor(HUDPrefab, () => {
  const data = useComponent(HUDData)

  onUpdate(() => {
    renderHUD({
      score: data.score,
      health: data.health,
    })
  })

  return {
    setScore: (n: number) => { data.score = n },
    setHealth: (n: number) => { data.health = n },
  }
})

// src/layouts/game-layout.ts
import { defineLayout, placeActor } from '@gwenjs/core/actor'
import { HUDActor } from '../actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  return { hud }
})

// From any scene's system — update the HUD:
const layout = useLayout(GameLayout)
layout.refs.hud.get()?.setScore(newScore)
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
| `placeActor(def)` | Place an actor in the layout → handle in `refs` |
| `placeGroup([...defs])` | Place multiple actors as a group |
| `placePrefab(def)` | Place a prefab entity in the layout |
| `useLayout(def)` | Get layout control handle |
| `layout.load()` | Activate the layout |
| `layout.dispose()` | Deactivate the layout |
| `layout.active` | `true` if layout is loaded |
| `layout.refs` | Object with placed actor handles |

## Next Steps

- **[Scenes](/essentials/scenes)** — How scenes work alongside layouts.
- **[Actors](/essentials/actors)** — Build the UI actors placed in your layout.
- **[Prefabs](/essentials/prefabs)** — Place prefab entities inside layouts.
