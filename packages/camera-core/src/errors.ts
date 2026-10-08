import { GwenError } from "@gwenjs/schema";
// packages/camera-core/src/errors.ts
/**
 * @file Camera error codes and error classes.
 *
 * All errors carry a `code`, a human-readable `hint`, and a `docsUrl`.
 * Callers may log these errors before throwing or handling them.
 */

export const CameraErrorCodes = {
  VIEWPORT_NOT_FOUND: "CAMERA:VIEWPORT_NOT_FOUND",
  EMPTY_PATH: "CAMERA:EMPTY_PATH",
  PERSPECTIVE_FALLBACK: "CAMERA:PERSPECTIVE_FALLBACK", // warn only, never thrown
  PRIORITY_CONFLICT: "CAMERA:PRIORITY_CONFLICT", // warn only, never thrown
} as const;

export type CameraErrorCode = (typeof CameraErrorCodes)[keyof typeof CameraErrorCodes];

/**
 * Thrown by `use2DCamera()`, `use3DCamera()`, and `Camera*Handle.setViewport()`
 * when the requested viewport id is not registered in `ViewportManager`.
 *
 * @example
 * ```ts
 * const err = new CameraViewportNotFoundError('minimap')
 * log.error(`[${err.code}] ${err.message} — ${err.hint}`)
 * throw err
 * ```
 */
export class CameraViewportNotFoundError extends GwenError {
  override readonly code = CameraErrorCodes.VIEWPORT_NOT_FOUND;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(viewportId: string) {
    super(CameraErrorCodes.VIEWPORT_NOT_FOUND, `[GwenCamera] Viewport "${viewportId}" not found.`);
    this.name = "CameraViewportNotFoundError";
    this.hint =
      `Declare it in defineConfig({ viewports: { "${viewportId}": { x, y, width, height } } }) ` +
      `or call useViewportManager().set("${viewportId}", region) at runtime.`;
    this.docsUrl = "https://gwenengine.dev/docs/camera#viewports";
  }
}

/**
 * Thrown by `Camera*Handle.playPath()` when the waypoints array is empty.
 *
 * @example
 * ```ts
 * const err = new CameraEmptyPathError()
 * log.error(`[${err.code}] ${err.message} — ${err.hint}`)
 * throw err
 * ```
 */
export class CameraEmptyPathError extends GwenError {
  override readonly code = CameraErrorCodes.EMPTY_PATH;
  readonly hint: string;
  readonly docsUrl: string;

  constructor() {
    super(CameraErrorCodes.EMPTY_PATH, `[GwenCamera] playPath() requires at least one waypoint.`);
    this.name = "CameraEmptyPathError";
    this.hint = "Provide a non-empty waypoints array to playPath().";
    this.docsUrl = "https://gwenengine.dev/docs/camera#playPath";
  }
}
