import type { CameraState } from "./camera-types";
import { useCameraManager } from "./use-camera-manager";
import { ScreenToWorldPerspectiveError, UnavailableCameraError } from "./errors";
import type { Vec3 } from "@gwenjs/math";
import { useScreen } from "./use-screen";

/**
 * Converts a screen-space pixel coordinate to a world-space position.
 *
 * The conversion is anchored on the active camera: the center of the viewport
 * maps exactly to the camera's world position. Only orthographic cameras are
 * supported — for perspective cameras, use {@link screenToRay} instead.
 *
 * @param px - X coordinate in pixels, origin at the top-left of the viewport.
 * @param py - Y coordinate in pixels, origin at the top-left of the viewport.
 * @param viewportId - Target viewport id. When omitted, the active camera with
 *   the highest priority is used automatically.
 * @returns World-space position as a {@link Vec3}. For 2D orthographic cameras,
 *   `z` equals the camera's world Z position.
 *
 * @throws {UnavailableCameraError} No active camera was found — either the scene
 *   has no camera, or the given `viewportId` is not bound to any active camera.
 * @throws {ScreenToWorldPerspectiveError} The active camera uses perspective
 *   projection. Use {@link screenToRay} to obtain a ray for perspective cameras.
 *
 * @example RTS — move units to the clicked world position
 * ```ts
 * onEvent('input:click', ({ x, y }) => {
 *   const worldPos = screenToWorld(x, y)
 *   for (const unit of selectedUnits) {
 *     unit.moveTo(worldPos.x, worldPos.y)
 *   }
 * })
 * ```
 *
 * @see {@link screenToRay} — perspective cameras, returns `{ origin, direction }`
 */
export function screenToWorld(px: number, py: number, viewportId?: string): Vec3 {
  const cameraManager = useCameraManager();
  let cameraState: CameraState | undefined;
  if (viewportId) {
    cameraState = cameraManager.get(viewportId);
  } else {
    for (const currentCam of cameraManager.getAll().values()) {
      if (currentCam.active) {
        cameraState = !cameraState
          ? currentCam
          : currentCam.priority > cameraState.priority
            ? currentCam
            : cameraState;
      }
    }
  }
  if (!cameraState) {
    throw new UnavailableCameraError(viewportId);
  }
  if (cameraState.projection.type !== "orthographic") {
    throw new ScreenToWorldPerspectiveError(cameraState.projection.type);
  }
  const { x: cx, y: cy, z: cz } = cameraState.worldTransform.position;
  const { zoom } = cameraState.projection;
  const { height, width } = useScreen(cameraState.viewportId).pixels;

  const x = (px - width / 2) / zoom + cx;
  const y = (py - height / 2) / zoom + cy;
  const z = cz;

  return {
    x,
    y,
    z,
  };
}
