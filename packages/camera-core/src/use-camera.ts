import { onCleanup, useEngine } from "@gwenjs/core";
import { useEntityId, useComponent } from "@gwenjs/core/actor";
import { Camera, CameraBounds, CameraShake } from "./components";
import { getCameraStores } from "./camera-stores";
import type { Camera2DHandle, Camera3DHandle, BoundsOpts2D, BoundsOpts3D } from "./camera-handle";
import type { ShakeOpts, ShakeHandle } from "./types";

/**
 * Options for an orthographic (2D) camera.
 * Pass to {@link useCamera} inside a `defineActor` factory.
 */
export interface Camera2DOpts {
  /** Must be `'orthographic'`. */
  projection: "orthographic";
  /** Viewport to render to. Defaults to `'main'`. */
  viewport?: string;
  /** Render priority — higher wins. Defaults to `0`. */
  priority?: number;
  /** Zoom factor. Defaults to `1`. */
  zoom?: number;
  /** Near clipping plane. Defaults to `0.1`. */
  near?: number;
  /** Far clipping plane. Defaults to `1000`. */
  far?: number;
}

/**
 * Options for a perspective (3D) camera.
 * Pass to {@link useCamera} inside a `defineActor` factory.
 */
export interface Camera3DOpts {
  /** Must be `'perspective'`. */
  projection: "perspective";
  /** Viewport to render to. Defaults to `'main'`. */
  viewport?: string;
  /** Render priority — higher wins. Defaults to `0`. */
  priority?: number;
  /** Field of view in radians. Defaults to `Math.PI / 3` (60°). */
  fov?: number;
  /** Near clipping plane. Defaults to `0.1`. */
  near?: number;
  /** Far clipping plane. Defaults to `1000`. */
  far?: number;
}

/**
 * Sets up a camera on this actor instance.
 *
 * Must be called inside a `defineActor` factory — `useCamera` is an actor
 * composable, not a scene or system one. The actor prefab must include the
 * `Camera`, `CameraBounds`, and `CameraShake` components. Use
 * `OrthographicCameraPrefab` or `PerspectiveCameraPrefab`.
 *
 * @example
 * ```ts
 * export const GameCameraActor = defineActor(OrthographicCameraPrefab, () => {
 *   const cam = useCamera({ projection: 'orthographic', viewport: 'main', zoom: 1.5 })
 *
 *   onStart(() => {
 *     cam.setPosition(0, 0)
 *     cam.setBounds({ minX: 0, maxX: 4000, minY: 0, maxY: 2000 })
 *   })
 * })
 * ```
 */

export function useCamera(opts: Camera2DOpts): Camera2DHandle;
export function useCamera(opts: Camera3DOpts): Camera3DHandle;
export function useCamera(opts: Camera2DOpts | Camera3DOpts): Camera2DHandle | Camera3DHandle {
  const entityId = useEntityId();
  const isOrtho = opts.projection === "orthographic";

  const camComp = useComponent(Camera);
  const boundsComp = useComponent(CameraBounds);
  const shakeComp = useComponent(CameraShake);

  const viewports = getCameraStores(useEngine()).viewports;
  let currentViewport = opts.viewport ?? "main";
  viewports.set(entityId, currentViewport);
  onCleanup(() => viewports.delete(entityId));

  camComp.$set({
    priority: opts.priority ?? 0,
    projectionType: isOrtho ? 0 : 1,
    zoom: isOrtho ? ((opts as Camera2DOpts).zoom ?? 1) : 0,
    fov: isOrtho ? 0 : ((opts as Camera3DOpts).fov ?? Math.PI / 3),
    near: opts.near ?? 0.1,
    far: opts.far ?? 1000,
  });

  const defaultShakeMax = isOrtho ? 20 : 0.05;

  const base = {
    setViewport(id: string): void {
      currentViewport = id;
      viewports.set(entityId, id);
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
    shake(intensity: number, shakeOpts?: ShakeOpts): ShakeHandle {
      shakeComp.$set({
        trauma: Math.min(1, intensity),
        decay: shakeOpts?.decay ?? 1,
        maxX: shakeOpts?.maxOffset?.x ?? defaultShakeMax,
        maxY: shakeOpts?.maxOffset?.y ?? defaultShakeMax,
      });
      return {
        trauma(amount: number): void {
          shakeComp.trauma = Math.min(1, shakeComp.trauma + amount);
        },
      };
    },
    clearBounds(): void {
      boundsComp.$set({
        minX: -Infinity,
        maxX: Infinity,
        minY: -Infinity,
        maxY: Infinity,
        minZ: -Infinity,
        maxZ: Infinity,
      });
    },
  };

  if (opts.projection === "orthographic") {
    const setBounds = (b: BoundsOpts2D): void => {
      boundsComp.$set({
        minX: b.minX ?? -Infinity,
        maxX: b.maxX ?? Infinity,
        minY: b.minY ?? -Infinity,
        maxY: b.maxY ?? Infinity,
        minZ: -Infinity,
        maxZ: Infinity,
      });
    };
    return {
      ...base,
      setBounds,
      setPosition(x: number, y: number): void {
        camComp.$set({ x, y });
      },
      setZoom(zoom: number): void {
        camComp.zoom = zoom;
      },
      getZoom(): number {
        return camComp.zoom;
      },
    };
  }

  const setBounds = (b: BoundsOpts3D): void => {
    boundsComp.$set({
      minX: b.minX ?? -Infinity,
      maxX: b.maxX ?? Infinity,
      minY: b.minY ?? -Infinity,
      maxY: b.maxY ?? Infinity,
      minZ: b.minZ ?? -Infinity,
      maxZ: b.maxZ ?? Infinity,
    });
  };
  return {
    ...base,
    setBounds,
    setPosition(x: number, y: number, z: number): void {
      camComp.$set({ x, y, z });
    },
    setRotation(rx: number, ry: number, rz: number): void {
      camComp.$set({ rotX: rx, rotY: ry, rotZ: rz });
    },
    setFov(fov: number): void {
      camComp.fov = fov;
    },
    getFov(): number {
      return camComp.fov;
    },
  };
}
