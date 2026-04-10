---
title: '@gwenjs/camera-core'
description: ECS camera system — components, CameraSystem pipeline, side-car stores, and engine hooks.
---

# `@gwenjs/camera-core`

Low-level ECS camera system shared by `@gwenjs/camera2d` and `@gwenjs/camera3d`. Provides
components, the `CameraSystem` orchestrator, side-car stores, and `CameraCorePlugin`.

> **Note** — You normally do not install this package directly. Use `@gwenjs/camera2d` or
> `@gwenjs/camera3d` instead — they register `CameraCorePlugin` automatically.

```bash
pnpm add @gwenjs/camera-core
```

## Quick start

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'
import { useViewportManager } from '@gwenjs/renderer-core'
import { CameraCorePlugin, Camera, cameraViewportMap } from '@gwenjs/camera-core'

const CameraSetupSystem = defineSystem('CameraSetupSystem', () => {
  const engine = useEngine()
  const viewports = useViewportManager()

  viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })

  const camId = engine.createEntity()
  engine.addComponent(camId, Camera, {
    active: 1,
    priority: 0,
    projectionType: 0,
    x: 0, y: 0, z: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    zoom: 1,
    fov: Math.PI / 3,
    near: -1000,
    far: 1000,
  })
  cameraViewportMap.set(camId, 'main')
})

export default defineConfig({
  plugins: [CameraCorePlugin(), CameraSetupSystem],
})
```

## ECS components

| Component | Purpose |
|---|---|
| `Camera` | Core state — position, rotation, projection, active flag, priority |
| `FollowTarget` | Lerps the camera toward another entity's position each frame |
| `CameraBounds` | Clamps the camera position to a bounding box after movement |
| `CameraShake` | Trauma-based screen shake — offsets the rendered position without modifying `Camera.x/y/z` |
| `CameraPath` | Bookmark for path-following state (current waypoint index + progress) |

### `Camera` fields

```ts
{
  active: 0 | 1         // 0 = inactive, 1 = active
  priority: number      // higher priority wins the viewport slot
  projectionType: 0 | 1 // 0 = orthographic, 1 = perspective
  x, y, z: number       // world position
  rotX, rotY, rotZ: number // Euler rotation (radians)
  zoom: number          // orthographic zoom factor
  fov: number           // perspective field-of-view (radians)
  near, far: number     // clipping planes
}
```

### `FollowTarget` fields

```ts
{
  entityId: bigint      // target entity (EntityId / u64)
  lerp: number          // interpolation factor per frame [0–1]
  offsetX, offsetY, offsetZ: number
}
```

### `CameraBounds` fields

```ts
{ minX, minY, minZ, maxX, maxY, maxZ: number }
```

### `CameraShake` fields

```ts
{
  trauma: number  // current trauma [0–1] — add to trigger shake
  decay: number   // trauma lost per second
  maxX: number    // max horizontal offset in world units
  maxY: number    // max vertical offset in world units
}
```

## Side-car stores

`cameraViewportMap` and `cameraPathStore` are module-level `Map`s that live alongside
the ECS components because strings and complex objects cannot be stored in SoA buffers.

```ts
import { cameraViewportMap, cameraPathStore } from '@gwenjs/camera-core'
import type { CameraPathData } from '@gwenjs/camera-core'

// Assign a camera to a viewport
cameraViewportMap.set(camId, 'main')

// Start a path
const pathData: CameraPathData = {
  waypoints: [
    { position: { x: 200, y: 0, z: 0 }, duration: 1.5, easing: 'easeInOut' },
    { position: { x: 200, y: 300, z: 0 }, duration: 1.0 },
  ],
  opts: { loop: false, onComplete: () => console.log('done') },
  elapsed: 0,
}
engine.addComponent(camId, CameraPath, { index: 0, progress: 0 })
cameraPathStore.set(camId, pathData)
```

## Engine hooks

`CameraSystem` may emit these hooks via `engine.hooks` when the active camera changes for a viewport:

| Hook | Payload | When |
|---|---|---|
| `camera:activate` | `{ viewportId: string, entityId: EntityId }` | First time a camera becomes active on a viewport |
| `camera:deactivate` | `{ viewportId: string }` | Active camera deactivated with no replacement |
| `camera:switch` | `{ viewportId: string, from: EntityId, to: EntityId }` | Active camera changes from one entity to another |

```ts
engine.hooks.hook('camera:activate', ({ viewportId, entityId }) => {
  console.log(`camera ${entityId} is now active on ${viewportId}`)
})
```

`viewport:*` hooks (`viewport:add`, `viewport:resize`, `viewport:remove`) are declared in
`@gwenjs/renderer-core`.

## `CameraSystem` pipeline

Each frame, `CameraSystem` runs the following steps:

1. `CameraManager.clearFrame()` — stale states are discarded
2. For each entity with `Camera.active = 1`:
   - Apply `FollowTarget` lerp toward the target entity — **or** advance `CameraPath` waypoints
   - Clamp to `CameraBounds`
   - Compute `CameraShake` offset (does **not** modify `Camera.x/y/z`)
   - Push `CameraState` to `CameraManager`
3. Detect semantic changes per viewport and emit `camera:activate / deactivate / switch`

## Multi-camera / priority

Multiple cameras can target the same viewport. The one with the highest `Camera.priority`
wins. On equal priority, the last entity to push its state wins.

## Building a custom camera handle

```ts
import { CameraCorePlugin, Camera, cameraViewportMap } from '@gwenjs/camera-core'
import { useCameraManager } from '@gwenjs/renderer-core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

const MyRenderSystem = defineSystem('MyRenderSystem', () => {
  const cameras = useCameraManager()
  onUpdate(() => {
    const state = cameras.get('main')
    if (state) {
      const { x, y, z } = state.worldTransform.position
      // apply to your renderer
    }
  })
})
```

## Error codes

```ts
const CameraErrorCodes = {
  VIEWPORT_NOT_FOUND:   'CAMERA:VIEWPORT_NOT_FOUND',
  EMPTY_PATH:           'CAMERA:EMPTY_PATH',
  PERSPECTIVE_FALLBACK: 'CAMERA:PERSPECTIVE_FALLBACK', // warn only, never thrown
  PRIORITY_CONFLICT:    'CAMERA:PRIORITY_CONFLICT',    // warn only, never thrown
}
```
