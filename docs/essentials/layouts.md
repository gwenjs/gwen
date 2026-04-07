---
title: Layouts
description: Layouts are persistent UI layers that survive scene transitions, perfect for HUDs, menus, and persistent UI elements.
---

# Layouts

A **layout** is a persistent UI layer that lives above all scenes. Unlike scenes (which load and unload), a layout persists across scene transitions. Use layouts for HUDs, menu bars, pause dialogs, and any UI that should survive when you change scenes.

## The Basics

### Defining a Layout

Use `defineLayout()` to create a persistent UI layer:

```ts
import { defineLayout, placeActor } from '@gwenjs/core/actor'
import { HUDActor } from './actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  return { hud }
})
```

### Loading a Layout

Layouts are typically loaded at startup or when entering gameplay:

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useLayout } from '@gwenjs/core/actor'
import { GameLayout } from './layouts'

export const LayoutInitSystem = defineSystem(() => {
  const level = useLayout(GameLayout)

  onUpdate(() => {
    if (!level.active && shouldLoadLayout) {
      level.load() // Persist this HUD across all scenes
    }
  })
})
```

Or use from a scene router initialization:

```ts
import { defineSceneRouter } from '@gwenjs/core/scene'
import { GameLayout } from './layouts'

export const router = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: {} },
    game: { scene: GameScene, on: {} },
  },
})
```

## In Practice

### HUD with Health and Score

A realistic HUD example:

```ts
// components/hud.ts
import { defineComponent, Types } from '@gwenjs/core'

export const HUDData = defineComponent({
  name: 'HUDData',
  schema: {
    score: Types.i32,
    health: Types.i32,
  },
})
```

```ts
// actors/hud.ts
import { defineActor, onStart, onUpdate } from '@gwenjs/core/actor'
import { useQuery, useEngine } from '@gwenjs/core/system'
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'
import { Health } from '../components'

export const HUDActor = defineActor(HUDPrefab, () => {
  const players = useQuery([Health])
  let hudEntity: bigint

  onStart(() => {
    const engine = useEngine()
    // Spawn the HUD entity
    hudEntity = engine.spawn([
      [HUDData, { score: 0, health: 100 }],
    ])
  })

  onUpdate(() => {
    // Update HUD from game state
    for (const playerId of players) {
      HUDData.score[hudEntity] += 10
      HUDData.health[hudEntity] = Health.current[playerId]
    }

    // Render HUD (canvas, DOM, etc.)
    renderHUD({
      score: HUDData.score[hudEntity],
      health: HUDData.health[hudEntity],
    })
  })

  return {}
})
```

### Layout Persists Across Scene Changes

Here's the key benefit: the layout stays alive when you change scenes:

```ts
// The layout stays alive regardless of which scene is active.
// As you navigate between scenes using nav.send(), the layout
// and its actors remain loaded — no reloading, no data loss.
```

### Updating Layout Data from Systems

Layouts provide a shared data layer that any scene's system can read and write:

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { useLayout } from '@gwenjs/core/actor'
import { GameLayout } from './layouts'
import { Health } from './components'
import { HUDData } from './components/hud'

export const HealthSyncSystem = defineSystem(() => {
  const players = useQuery([Health])
  const level = useLayout(GameLayout)

  onUpdate(() => {
    for (const playerId of players) {
      // Update the HUD directly from any scene's system
      if (level.active && level.refs.hud) {
        const hudEntity = level.refs.hud // Reference to spawned HUD entity
        HUDData.health[hudEntity] = Health.current[playerId]
      }
    }
  })
})
```

## Layout vs Scene

- **Scenes** load/unload as a unit. A new scene means new systems, new actors, new data.
- **Layouts** persist across all scenes. One layout, one set of UI actors, shared data.

Use **layouts** for:
- Health/score/timer HUD
- Menu bars or top navigation
- Persistent dialogs or notifications
- Global audio or input handlers

Use **scenes** for:
- Game states (menu, gameplay, game over)
- Level-specific logic and entities
- Cleanup and memory management between states

## API Summary

| Function | Description |
|---|---|
| `defineLayout(factory)` | Declare a persistent UI layer |
| `useLayout(LayoutDef, opts?)` | Get layout control from a system or actor |
| `layout.load()` | Load/activate the layout |
| `layout.dispose()` | Unload/deactivate the layout |
| `layout.active` | Boolean indicating if layout is loaded |
| `layout.refs` | Object containing references to placed actors |

## Next Steps

- **[Scenes](/essentials/scenes)** — Learn how scenes work with layouts.
- **[Prefabs](/essentials/prefabs)** — Spawn HUD elements using prefabs.
- **[Actors](/essentials/scenes)** — Create custom UI actors for your layout.
