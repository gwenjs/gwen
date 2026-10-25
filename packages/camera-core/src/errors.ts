import { GwenError } from "@gwenjs/schema";
/**
 * @file Camera error codes and error classes.
 *
 * Each class extends {@link GwenError}. `docsUrl` is derived from the code.
 * `hint` is passed only inside `__GWEN_DEV__ ? … : undefined`.
 */

export const CameraErrorCodes = {
  VIEWPORT_NOT_FOUND: "CAMERA:VIEWPORT_NOT_FOUND",
  EMPTY_PATH: "CAMERA:EMPTY_PATH",
  PERSPECTIVE_FALLBACK: "CAMERA:PERSPECTIVE_FALLBACK", // warn only, never thrown
  PRIORITY_CONFLICT: "CAMERA:PRIORITY_CONFLICT", // warn only, never thrown
} as const;

export type CameraErrorCode = (typeof CameraErrorCodes)[keyof typeof CameraErrorCodes];

/**
 * Declared for camera consumers. camera-core never throws it.
 *
 * @example
 * ```ts
 * throw new CameraViewportNotFoundError('minimap')
 * ```
 */
export class CameraViewportNotFoundError extends GwenError {
  override readonly code = CameraErrorCodes.VIEWPORT_NOT_FOUND;

  constructor(viewportId: string) {
    super(CameraErrorCodes.VIEWPORT_NOT_FOUND, `Viewport "${viewportId}" not found.`, {
      hint: __GWEN_DEV__
        ? `Declare it in defineConfig({ viewports: { "${viewportId}": { x, y, width, height } } }) or call useViewportManager().set("${viewportId}", region) at runtime.`
        : undefined,
    });
    this.name = "CameraViewportNotFoundError";
  }
}

/**
 * Thrown by `Camera*Handle.playPath()` and `setCameraPath()` when the waypoints array is empty.
 *
 * @example
 * ```ts
 * throw new CameraEmptyPathError()
 * ```
 */
export class CameraEmptyPathError extends GwenError {
  override readonly code = CameraErrorCodes.EMPTY_PATH;

  constructor() {
    super(CameraErrorCodes.EMPTY_PATH, "playPath() requires at least one waypoint.", {
      hint: __GWEN_DEV__ ? "Provide a non-empty waypoints array to playPath()." : undefined,
    });
    this.name = "CameraEmptyPathError";
  }
}
