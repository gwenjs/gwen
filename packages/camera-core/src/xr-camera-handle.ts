// packages/camera-core/src/xr-camera-handle.ts
/**
 * @file Types for XR camera handles and per-eye view data.
 */

/**
 * Per-eye view data provided by the WebXR session each frame.
 * Matches the data available from `XRView` in the WebXR Device API.
 */
export interface XRViewData {
  /** Which eye this view corresponds to. `'none'` for mono (AR or inline). */
  eye: "left" | "right" | "none";
  /**
   * Column-major 4×4 view matrix (world space → camera space).
   * Equivalent to `XRView.transform.inverse.matrix`.
   */
  viewMatrix: Float32Array;
  /**
   * Column-major 4×4 projection matrix for this eye.
   * Equivalent to `XRView.projectionMatrix`.
   */
  projectionMatrix: Float32Array;
}

/**
 * Handle returned by `useXRCamera`. Represents the XR viewer (the headset) as
 * a single logical camera — the XR renderer plugin manages per-eye rendering internally.
 *
 * The renderer plugin calls `_setViews` each frame with fresh WebXR data.
 * Game code reads `getHeadPosition` for world-space HUD anchoring and similar needs.
 */
export interface XRCameraHandle {
  /** Reassign this camera to a different viewport. */
  setViewport(id: string): void;
  /** Current viewport id. */
  getViewport(): string;
  /** Render priority — higher value wins when multiple cameras target the same viewport. */
  setPriority(priority: number): void;
  /** Enable or disable this camera. An inactive camera is skipped by CameraSystem. */
  setActive(active: boolean): void;
  /**
   * Head world-space position derived from the last view matrices.
   * Returns `undefined` before the first `_setViews` call.
   */
  getHeadPosition(): { x: number; y: number; z: number } | undefined;
  /**
   * Called by the XR renderer plugin each frame with per-eye view data extracted
   * from `XRViewerPose.views`. Not intended for game code.
   */
  _setViews(views: XRViewData[]): void;
}
