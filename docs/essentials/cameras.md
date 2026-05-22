---
title: Cameras
description: Actor-based cameras with orthographic and perspective projections, shake, and bounds.
---

# Cameras

A **camera** in GWEN is an actor. It owns an ECS entity, has a lifecycle, and is declared in a scene like any other actor. The `useCamera()` composable is called inside `defineActor()` to configure the camera and get a typed handle.

::: info Auto-imports
`useCamera`, `OrthographicCameraPrefab`, and `PerspectiveCameraPrefab` are auto-imported in a GWEN project. The plugin must be installed first:

```ts
import { CameraCorePlugin } from '@gwenjs/camera-core'
```
:::

## The Two Projections

| Prefab | Projection | Handle |
|---|---|---|
| `OrthographicCameraPrefab` | 2D, zoom-based | `Camera2DHandle` |
| `PerspectiveCameraPrefab` | 3D, fov-based | `Camera3DHandle` |

## Defining a Camera Actor

`useCamera()` must be called inside a `defineActor()` factory. Use the matching prefab.

```ts
import { OrthographicCameraPrefab } from '@gwenjs/camera-core'

export const GameCameraActor = defineActor(OrthographicCameraPrefab, () => {
  const cam = useCamera({ projection: 'orthographic', viewport: 'main', zoom: 1.5 })

  onStart(() => {
    cam.setPosition(0, 0)
    cam.setBounds({ minX: 0, maxX: 4000, minY: 0, maxY: 2000 })
  })
})
```

```ts
import { PerspectiveCameraPrefab } from '@gwenjs/camera-core'

export const SceneCameraActor = defineActor(PerspectiveCameraPrefab, () => {
  const cam = useCamera({ projection: 'perspective', viewport: 'main', fov: Math.PI / 3 })

  onStart(() => {
    cam.setPosition(0, 5, 10)
    cam.setRotation(-0.4, 0, 0)
  })
})
```

## Declaring in a Scene

```ts
export const GameScene = defineScene('game', () => {
  const camera = useActor(GameCameraActor)

  onEnter(() => camera.spawn())
  onExit(() => camera.despawnAll())
})
```

## useCamera Options

### Camera2DOpts

| Option | Type | Default | Description |
|---|---|---|---|
| `projection` | `'orthographic'` | required | Selects orthographic projection. |
| `viewport` | `string` | `'main'` | Viewport to render to. |
| `priority` | `number` | `0` | Higher value wins when multiple cameras target the same viewport. |
| `zoom` | `number` | `1` | Zoom factor. Values above 1 zoom in, below 1 zoom out. |
| `near` | `number` | `0.1` | Near clipping plane. |
| `far` | `number` | `1000` | Far clipping plane. |

### Camera3DOpts

| Option | Type | Default | Description |
|---|---|---|---|
| `projection` | `'perspective'` | required | Selects perspective projection. |
| `viewport` | `string` | `'main'` | Viewport to render to. |
| `priority` | `number` | `0` | Higher value wins when multiple cameras target the same viewport. |
| `fov` | `number` | `Math.PI / 3` | Vertical field of view in radians (60° by default). |
| `near` | `number` | `0.1` | Near clipping plane. |
| `far` | `number` | `1000` | Far clipping plane. |

## Camera2DHandle API

```ts
const cam = useCamera({ projection: 'orthographic' })

cam.setPosition(x, y)       // move to world position
cam.setZoom(zoom)           // set zoom factor
cam.getZoom()               // read current zoom
cam.setViewport('hud')      // reassign to a different viewport
cam.getViewport()           // read current viewport id
cam.setPriority(10)         // override render priority
cam.setActive(false)        // disable — camera is skipped by CameraSystem
cam.setBounds({ minX: 0, maxX: 2000, minY: 0, maxY: 1000 })
cam.clearBounds()           // remove bounds — camera moves freely
cam.shake(0.6)              // apply trauma-based screen shake
```

## Camera3DHandle API

```ts
const cam = useCamera({ projection: 'perspective' })

cam.setPosition(x, y, z)        // move to world position
cam.setRotation(rx, ry, rz)     // set euler rotation (radians)
cam.setFov(Math.PI / 2)         // set vertical field of view
cam.getFov()                    // read current fov
cam.setViewport('main')
cam.getViewport()
cam.setPriority(5)
cam.setActive(false)
cam.setBounds({ minX: -100, maxX: 100, minZ: -50, maxZ: 50 })
cam.clearBounds()
cam.shake(0.4)
```

## Screen Shake

`shake(intensity)` applies a trauma-based shake. `intensity` is clamped to `[0, 1]`. The returned handle lets you add more trauma from anywhere.

```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  const camera = useActor(GameCameraActor)

  return {
    onHit() {
      const shakeHandle = camera.get()?.shake(0.5)
      // add more trauma later
      shakeHandle?.trauma(0.2)
    },
  }
})
```

Shake options:

```ts
cam.shake(0.6, {
  decay: 2,                         // trauma decay rate per second (default 1)
  maxOffset: { x: 40, y: 40 },     // max pixel offset for orthographic
})
```

## Bounds

`setBounds` clamps the camera position to a world-space rectangle. Useful to prevent showing areas outside the map.

```ts
// 2D — clamp to map edges
cam.setBounds({ minX: 0, maxX: 4000, minY: 0, maxY: 2000 })

// 3D — clamp all axes
cam.setBounds({ minX: -50, maxX: 50, minY: 0, maxY: 20, minZ: -50, maxZ: 50 })

// Remove bounds
cam.clearBounds()
```

Unspecified axes default to `±Infinity`.

## Multiple Cameras and Priority

Multiple cameras can target the same viewport — the one with the highest `priority` wins each frame. Equal priority: the last write wins.

```ts
// Main gameplay camera
const mainCam = useCamera({ projection: 'orthographic', viewport: 'main', priority: 0 })

// Cutscene camera — higher priority takes over when spawned
const cutsceneCam = useCamera({ projection: 'orthographic', viewport: 'main', priority: 10 })
```

## Viewport Assignment

A camera targets a single viewport by name. Reassign at runtime with `setViewport()`.

```ts
cam.setViewport('minimap')
```

Viewport regions are declared in `gwen.config.ts`:

```ts
export default defineConfig({
  viewports: {
    main:    { x: 0, y: 0, width: 1,    height: 1 },
    minimap: { x: 0.75, y: 0, width: 0.25, height: 0.25 },
  },
})
```

## Building a Custom Camera

Any plugin or module can build its own camera composable using the lower-level `camera-core` API directly. The only requirement: call `useCamera()` inside `defineActor()` with a prefab that includes `Camera`, `CameraBounds`, and `CameraShake`.

```ts
import { defineActor } from '@gwenjs/core/actor'
import { OrthographicCameraPrefab, useCamera } from '@gwenjs/camera-core'

export const TopDownCameraActor = defineActor(OrthographicCameraPrefab, (props: { target: EntityId }) => {
  const cam = useCamera({ projection: 'orthographic', viewport: 'main' })

  // follow props.target every frame
  onUpdate(() => {
    // ... read target position and call cam.setPosition(...)
  })
})
```

## API Summary

| | |
|---|---|
| `OrthographicCameraPrefab` | Prefab for 2D cameras — includes `Camera`, `CameraBounds`, `CameraShake` |
| `PerspectiveCameraPrefab` | Prefab for 3D cameras — includes `Camera`, `CameraBounds`, `CameraShake` |
| `useCamera(opts)` | Actor composable — returns `Camera2DHandle` or `Camera3DHandle` |
| `cam.setPosition(x, y)` | Move camera (2D) |
| `cam.setPosition(x, y, z)` | Move camera (3D) |
| `cam.setZoom(zoom)` | Set zoom factor (2D only) |
| `cam.setFov(fov)` | Set field of view in radians (3D only) |
| `cam.setRotation(rx, ry, rz)` | Set euler rotation (3D only) |
| `cam.setViewport(id)` | Reassign to viewport |
| `cam.setPriority(n)` | Override render priority |
| `cam.setActive(bool)` | Enable or disable camera |
| `cam.setBounds(opts)` | Clamp camera position |
| `cam.clearBounds()` | Remove position clamp |
| `cam.shake(intensity, opts?)` | Apply screen shake, returns `ShakeHandle` |

## Next Steps

- **[Actors](/essentials/actors)** — How actors work in GWEN.
- **[Prefabs](/essentials/prefabs)** — Define component layouts for actors.
- **[Scenes](/essentials/scenes)** — Declare and control actors from a scene.
