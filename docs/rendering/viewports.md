---
title: Viewports
description: Divide the screen into named regions — full screen, split-screen, minimap, 4-player — and connect cameras to each one.
---

# Viewports

A **viewport** is a named, normalized region of the screen. GWEN uses viewports to split the render surface into independent render targets — one camera per viewport, each with its own transform and projection.

All coordinates are normalized to `[0–1]`, where `(0, 0)` is the top-left corner and `(1, 1)` is the bottom-right.

```
┌───────────────────────┐
│  x: 0  y: 0           │
│  width: 1  height: 1  │   ← full screen
└───────────────────────┘

┌───────────┬───────────┐
│  p1       │  p2       │   ← split-screen
│  w: 0.5   │  x: 0.5   │
└───────────┴───────────┘
```

## Static declaration — `gwen.config.ts`

Declare viewports once in `gwen.config.ts`. GWEN registers them at engine startup, before any camera or renderer plugin runs.

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/camera2d', '@gwenjs/renderer-html'],
  viewports: {
    main: { x: 0, y: 0, width: 1, height: 1 },
  },
})
```

::: tip Default viewport
If you omit the `viewports` key entirely, GWEN automatically creates a single fullscreen viewport named `'main'`. You only need to declare viewports explicitly when you want more than one.
:::

## Common layouts

### Split-screen (2 players)

```ts
export default defineConfig({
  viewports: {
    p1: { x: 0,   y: 0, width: 0.5, height: 1 },
    p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
  },
})
```

### 4-player grid

```ts
export default defineConfig({
  viewports: {
    p1: { x: 0,   y: 0,   width: 0.5, height: 0.5 },
    p2: { x: 0.5, y: 0,   width: 0.5, height: 0.5 },
    p3: { x: 0,   y: 0.5, width: 0.5, height: 0.5 },
    p4: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  },
})
```

### Main view + minimap

```ts
export default defineConfig({
  viewports: {
    main:    { x: 0,    y: 0,    width: 1,    height: 1    },
    minimap: { x: 0.75, y: 0.75, width: 0.25, height: 0.25 },
  },
})
```

## Dynamic viewports — `useViewportManager()`

For layouts that change at runtime — a player joins mid-game, a minimap toggles on — use `useViewportManager()` inside a system or actor.

```ts
import { useViewportManager } from '@gwenjs/renderer-core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const LayoutSystem = defineSystem('LayoutSystem', () => {
  const viewports = useViewportManager()

  onUpdate(() => {
    if (player2Joined) {
      // Switch from full screen to split-screen
      viewports.set('p1', { x: 0,   y: 0, width: 0.5, height: 1 })
      viewports.set('p2', { x: 0.5, y: 0, width: 0.5, height: 1 })
      viewports.remove('main')
    }
  })
})
```

::: warning Call order
`useViewportManager()` must be called in the **setup phase** of a system or actor (outside of `onUpdate`). The returned manager reference is stable — you can call `.set()` / `.remove()` on it from anywhere.
:::

### API

| Method | Description |
|---|---|
| `set(id, region)` | Register or resize a viewport. Emits `viewport:add` on first call, `viewport:resize` on update. |
| `remove(id)` | Remove a viewport. Emits `viewport:remove`. No-op for unknown ids. |
| `get(id)` | Returns the `ViewportContext` for this id, or `undefined`. |
| `getAll()` | Live read-only map of all registered viewports. Do not mutate. |

## Reacting to viewport changes

Any plugin or system can subscribe to viewport lifecycle hooks:

```ts
import { useEngine } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const ViewportListenerSystem = defineSystem('ViewportListenerSystem', () => {
  const engine = useEngine()

  engine.hooks.hook('viewport:add', ({ id, region }) => {
    console.log(`viewport "${id}" added`, region)
  })

  engine.hooks.hook('viewport:resize', ({ id, region }) => {
    console.log(`viewport "${id}" resized`, region)
  })

  engine.hooks.hook('viewport:remove', ({ id }) => {
    console.log(`viewport "${id}" removed`)
  })
})
```

| Hook | Payload | When |
|---|---|---|
| `viewport:add` | `{ id, region }` | A new viewport is registered |
| `viewport:resize` | `{ id, region }` | An existing viewport's region changes |
| `viewport:remove` | `{ id }` | A viewport is removed |

## Connecting a camera to a viewport

A viewport is just a screen region — it has no camera by itself. Assign a camera entity to a viewport via `cameraViewportMap` from `@gwenjs/camera-core`:

```ts
import { Camera, cameraViewportMap } from '@gwenjs/camera-core'
import { useEngine } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const CameraSetupSystem = defineSystem('CameraSetupSystem', () => {
  const engine = useEngine()

  const camId = engine.createEntity()
  engine.addComponent(camId, Camera, {
    active: 1,
    priority: 0,
    projectionType: 0, // orthographic
    x: 0, y: 0, z: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    zoom: 1,
    fov: Math.PI / 3,
    near: -1000,
    far: 1000,
  })

  // Bind the camera to the 'main' viewport
  cameraViewportMap.set(camId, 'main')
})
```

::: tip camera2d / camera3d
When using `@gwenjs/camera2d` or `@gwenjs/camera3d`, the `use2DCamera()` / `use3DCamera()` composables handle entity creation and viewport binding for you. The low-level approach above is only needed when building custom camera logic.
:::

## Next steps

- **[`@gwenjs/camera-core` API](/api/camera-core)** — ECS components, CameraSystem pipeline, and error codes.
- **[`@gwenjs/renderer-core` API](/api/renderer-core)** — ViewportManager, CameraManager, and LayerDef reference.
- **[Writing a Custom Renderer](/kit/custom-renderer)** — Integrate ViewportManager into your renderer plugin.
