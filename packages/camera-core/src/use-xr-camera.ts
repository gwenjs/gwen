// packages/camera-core/src/use-xr-camera.ts
import { onCleanup, useEngine } from "@gwenjs/core";
import { useEntityId, useComponent } from "@gwenjs/core/actor";
import { Camera } from "./components";
import { getCameraStores } from "./camera-stores";
import type { XRCameraHandle, XRViewData } from "./xr-camera-handle";

/** Options accepted by {@link useXRCamera}. */
export interface XRCameraOpts {
  /** Viewport to render to. Defaults to `'main'`. */
  viewport?: string;
  /** Render priority — higher wins. Defaults to `0`. */
  priority?: number;
}

/**
 * Sets up a WebXR camera on this actor instance.
 *
 * Must be called inside a `defineActor` factory using `XRCameraPrefab`.
 * The actor represents the XR viewer (the headset) as a single logical camera.
 * Per-eye rendering is handled internally by the XR renderer plugin, which calls
 * `handle._setViews(views)` each frame with data from `XRViewerPose.views`.
 *
 * `CameraSystem` skips XR cameras entirely (`projectionType === 2`). The XR renderer
 * plugin is responsible for updating `CameraManager` directly.
 *
 * @example
 * ```ts
 * export const XRViewerActor = defineActor(XRCameraPrefab, () => {
 *   const cam = useXRCamera({ viewport: 'main', priority: 10 })
 *
 *   onUpdate(() => {
 *     const head = cam.getHeadPosition()
 *     if (head) positionHUDAt(head.x, head.y, head.z)
 *   })
 *
 *   // Expose _setViews so the XR renderer plugin can drive the camera each frame.
 *   return { cam }
 * })
 * ```
 */
export function useXRCamera(opts: XRCameraOpts = {}): XRCameraHandle {
  const entityId = useEntityId();
  const camComp = useComponent(Camera);

  const stores = getCameraStores(useEngine());
  let currentViewport = opts.viewport ?? "main";
  let lastViews: XRViewData[] | undefined;

  stores.viewports.set(entityId, currentViewport);
  onCleanup(() => {
    stores.viewports.delete(entityId);
    stores.matrices.delete(entityId);
  });

  camComp.$set({
    priority: opts.priority ?? 0,
    projectionType: 2,
  });

  return {
    setViewport(id: string): void {
      currentViewport = id;
      stores.viewports.set(entityId, id);
    },
    getViewport(): string {
      return currentViewport;
    },
    setPriority(priority: number): void {
      camComp.priority = priority;
    },
    setActive(active: boolean): void {
      camComp.active = active ? 1 : 0;
    },
    getHeadPosition() {
      if (!lastViews || lastViews.length === 0) return undefined;
      // Derive world-space head position from the first view matrix.
      // For a column-major view matrix V (world → camera), the camera world position
      // is p = -R^T * t, where R is the 3×3 rotation block and t = [v[12], v[13], v[14]].
      // Column-major layout: R row i = [v[i], v[i+4], v[i+8]]
      const v = lastViews[0]!.viewMatrix;
      return {
        x: -(v[0]! * v[12]! + v[4]! * v[13]! + v[8]! * v[14]!),
        y: -(v[1]! * v[12]! + v[5]! * v[13]! + v[9]! * v[14]!),
        z: -(v[2]! * v[12]! + v[6]! * v[13]! + v[10]! * v[14]!),
      };
    },
    _setViews(views: XRViewData[]): void {
      lastViews = views;
      stores.matrices.set(entityId, views);
    },
  };
}
