// packages/camera-core/src/xr-camera-prefab.ts
/**
 * @file Prefab for WebXR camera actors.
 *
 * Uses `projectionType: 2` as the XR marker so `CameraSystem` skips normal
 * projection processing for these entities. The XR renderer plugin manages
 * per-eye rendering and `CameraManager` updates instead.
 */

import { definePrefab } from "@gwenjs/core/actor";
import { Camera } from "./components";

/**
 * Prefab for WebXR camera actors.
 * Use with `useXRCamera()` inside a `defineActor` factory.
 *
 * @example
 * ```ts
 * export const XRViewerActor = defineActor(XRCameraPrefab, () => {
 *   const cam = useXRCamera({ viewport: 'main' })
 *   return { cam }
 * })
 * ```
 */
export const XRCameraPrefab = definePrefab([
  {
    def: Camera,
    defaults: {
      active: 1,
      priority: 0,
      projectionType: 2, // 2 = XR — CameraSystem skips these entities
      zoom: 0,
      fov: 0,
      near: 0.1,
      far: 1000,
      x: 0,
      y: 0,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
    },
  },
]);
