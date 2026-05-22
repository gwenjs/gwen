import type { ShakeOpts, ShakeHandle } from "./types";

/** Shared methods available on all camera handles. */
export interface CameraHandleBase {
  /** Reassign this camera to a different viewport. */
  setViewport(id: string): void;
  /** Current viewport id. */
  getViewport(): string;
  /** Render priority — higher value wins when multiple cameras target the same viewport. */
  setPriority(priority: number): void;
  /** Enable or disable this camera. An inactive camera is skipped by CameraSystem. */
  setActive(active: boolean): void;
  /** Add a trauma-based screen shake. Returns a handle to add more trauma later. */
  shake(intensity: number, opts?: ShakeOpts): ShakeHandle;
  /** Constrain camera movement to world-space bounds. */
  setBounds(bounds: BoundsOpts2D | BoundsOpts3D): void;
  /** Remove bounds constraints — camera can move freely. */
  clearBounds(): void;
}

export interface Camera2DHandle extends CameraHandleBase {
  /** Move the camera to the given world-space position. */
  setPosition(x: number, y: number): void;
  /** Set the orthographic zoom factor. Values above 1 zoom in, below 1 zoom out. */
  setZoom(zoom: number): void;
  /** Current zoom factor. */
  getZoom(): number;
  /** Constrain camera movement to 2D world-space bounds. */
  setBounds(bounds: BoundsOpts2D): void;
}

export interface Camera3DHandle extends CameraHandleBase {
  /** Move the camera to the given world-space position. */
  setPosition(x: number, y: number, z: number): void;
  /** Set the camera rotation in euler angles (radians). */
  setRotation(rx: number, ry: number, rz: number): void;
  /** Set the vertical field of view in radians. */
  setFov(fov: number): void;
  /** Current vertical field of view in radians. */
  getFov(): number;
  /** Constrain camera movement to 3D world-space bounds. */
  setBounds(bounds: BoundsOpts3D): void;
}

export interface BoundsOpts2D {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}
export interface BoundsOpts3D extends BoundsOpts2D {
  minZ?: number;
  maxZ?: number;
}
