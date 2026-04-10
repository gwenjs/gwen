# `@gwenjs/camera-core`

ECS camera system for Gwen. Provides the components, `CameraSystem` orchestrator, and `CameraCorePlugin` shared by `@gwenjs/camera2d` and `@gwenjs/camera3d`.

> **Note** — you normally do not install this package directly. Use `@gwenjs/camera2d` or `@gwenjs/camera3d` instead. They install `CameraCorePlugin` automatically.

## Installation

```sh
npm install @gwenjs/camera-core
```

## Quick start

```ts
import { createEngine } from "@gwenjs/core";
import { CameraCorePlugin, Camera, cameraViewportMap } from "@gwenjs/camera-core";

const engine = await createEngine({ maxEntities: 1000 });
await engine.use(CameraCorePlugin());

// Register a viewport (normalized [0–1] region — full screen)
engine.inject("viewportManager").set("main", { x: 0, y: 0, width: 1, height: 1 });

// Create a camera entity
const camId = engine.createEntity();
engine.addComponent(camId, Camera, {
  active: 1,
  priority: 0,
  projectionType: 0, // 0 = orthographic, 1 = perspective
  x: 0,
  y: 0,
  z: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  zoom: 1,
  fov: Math.PI / 3,
  near: -1000,
  far: 1000,
});
cameraViewportMap.set(camId, "main");
```

## ECS components

| Component      | Purpose                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `Camera`       | Core camera state — position, rotation, projection, active flag, priority               |
| `FollowTarget` | Lerps the camera toward another entity's position each frame                            |
| `CameraBounds` | Clamps the camera position to a bounding box after movement                             |
| `CameraShake`  | Trauma-based screen shake — offsets the rendered position without moving `Camera.x/y/z` |
| `CameraPath`   | ECS bookmark for path-following state (index + progress in current segment)             |

### `Camera` fields

```ts
{
  active: 0 | 1,       // 0 = inactive, 1 = active
  priority: number,    // higher priority wins the viewport slot
  projectionType: 0 | 1, // 0 = orthographic, 1 = perspective
  x, y, z: number,    // world position
  rotX, rotY, rotZ: number, // euler rotation (radians)
  zoom: number,        // orthographic zoom
  fov: number,         // perspective field-of-view (radians)
  near, far: number,   // clipping planes
}
```

### `FollowTarget` fields

```ts
{
  entityId: number,    // target entity (u32 cast of EntityId)
  lerp: number,        // interpolation factor per frame [0–1]
  offsetX, offsetY, offsetZ: number,
}
```

### `CameraBounds` fields

```ts
{ minX, minY, minZ, maxX, maxY, maxZ: number }
```

### `CameraShake` fields

```ts
{
  trauma: number,  // current trauma [0–1], add to it to trigger shake
  decay: number,   // trauma lost per second
  maxX: number,    // max horizontal offset in world units
  maxY: number,    // max vertical offset in world units
}
```

## Side-car stores

`cameraViewportMap` and `cameraPathStore` are module-level `Map`s that live alongside the ECS components because strings and complex objects cannot be stored in SoA buffers.

```ts
import { cameraViewportMap, cameraPathStore } from "@gwenjs/camera-core";
import type { CameraPathData } from "@gwenjs/camera-core";

// Assign a camera to a viewport
cameraViewportMap.set(camId, "main");

// Start a path
const pathData: CameraPathData = {
  waypoints: [
    { position: { x: 200, y: 0, z: 0 }, duration: 1.5, easing: "easeInOut" },
    { position: { x: 200, y: 300, z: 0 }, duration: 1.0 },
  ],
  opts: { loop: false, onComplete: () => console.log("done") },
  elapsed: 0,
};
engine.addComponent(camId, CameraPath, { index: 0, progress: 0 });
cameraPathStore.set(camId, pathData);
```

## Engine hooks

`CameraSystem` emits these hooks each frame via `engine.hooks`:

| Hook                | Payload                                                | When                                                 |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `camera:activate`   | `{ viewportId: string, entityId: EntityId }`           | First time a camera becomes active on a viewport     |
| `camera:deactivate` | `{ viewportId: string }`                               | The active camera is deactivated with no replacement |
| `camera:switch`     | `{ viewportId: string, from: EntityId, to: EntityId }` | Active camera changes from one entity to another     |

```ts
engine.hooks.hook("camera:activate", ({ viewportId, entityId }) => {
  console.log(`camera ${entityId} is now active on ${viewportId}`);
});
```

`viewport:*` hooks (`viewport:add`, `viewport:resize`, `viewport:remove`) are declared in `@gwenjs/renderer-core`.

## `CameraSystem` pipeline (per frame)

1. `CameraManager.clearFrame()` — stale states are discarded
2. For each entity in `useQuery([Camera])` with `active = 1`:
   - Apply `FollowTarget` lerp toward the target entity — **or** advance `CameraPath` waypoints
   - Clamp to `CameraBounds`
   - Compute `CameraShake` offset (does **not** modify `Camera.x/y/z`)
   - Push `CameraState` to `CameraManager`
3. Detect semantic changes per viewport and emit `camera:activate / deactivate / switch`

## Multi-camera / priority

Multiple cameras can target the same viewport. The one with the highest `Camera.priority` wins. On equal priority, the last entity to push its state wins.

## Building a custom camera handle

If `camera2d`/`camera3d` don't fit your needs, you can build your own on top of `camera-core`:

```ts
import { CameraCorePlugin, Camera, cameraViewportMap } from "@gwenjs/camera-core";
import { useCameraManager } from "@gwenjs/renderer-core";
import { defineSystem, onUpdate } from "@gwenjs/core/system";

await engine.use(CameraCorePlugin());

// Your system reads CameraManager after CameraSystem runs
const MyRenderSystem = defineSystem("MyRenderSystem", () => {
  const cameras = useCameraManager();
  onUpdate(() => {
    const state = cameras.get("main");
    if (state) {
      const { x, y, z } = state.worldTransform.position;
      // apply to your renderer
    }
  });
});
```
