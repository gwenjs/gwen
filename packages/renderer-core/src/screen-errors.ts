import { GwenError } from "@gwenjs/schema";
/**
 * @file Screen error codes and error classes.
 *
 * Each class extends {@link GwenError}. `docsUrl` is derived from the code.
 * `hint` is passed only inside `__GWEN_DEV__ ? … : undefined`.
 */

/** Error codes emitted by the GWEN screen system. */
export const ScreenErrorCodes = {
  /**
   * ResizeObserver is required but not available in this environment.
   * Occurs when running in Node.js or an old browser without a `sizeProvider` configured.
   */
  ResizeObserverNotAvailable: "RENDERER:SCREEN_RESIZE_OBSERVER_NOT_AVAILABLE",
  /**
   * `useScreen()` was called with a viewport id that is not registered
   * in the current `ViewportManager`.
   */
  ViewportNotFound: "RENDERER:SCREEN_VIEWPORT_NOT_FOUND",
} as const;

/** Union of all screen error code string literals. */
export type ScreenErrorCode = (typeof ScreenErrorCodes)[keyof typeof ScreenErrorCodes];

/**
 * Thrown when `ScreenPlugin` detects that `ResizeObserver` is unavailable
 * and no `sizeProvider` was configured.
 *
 * @example
 * ```ts
 * throw new ScreenResizeObserverError()
 * ```
 */
export class ScreenResizeObserverError extends GwenError {
  override readonly code = ScreenErrorCodes.ResizeObserverNotAvailable;

  constructor() {
    super(
      ScreenErrorCodes.ResizeObserverNotAvailable,
      "ResizeObserver is not available in this environment.",
      {
        hint: __GWEN_DEV__
          ? "Pass `screen: { sizeProvider: StaticSizeProvider({ width: W, height: H }) }` in gwen.config.ts for Node.js or server environments."
          : undefined,
      },
    );
    this.name = "ScreenResizeObserverError";
  }
}

/**
 * Thrown when `useScreen()` is called with a viewport id that is not
 * registered in the current `ViewportManager`.
 *
 * @example
 * ```ts
 * throw new ScreenViewportNotFoundError('p3', ['main', 'p1', 'p2'])
 * ```
 */
export class ScreenViewportNotFoundError extends GwenError {
  override readonly code = ScreenErrorCodes.ViewportNotFound;
  readonly viewportId: string;
  readonly knownViewports: string[];

  constructor(viewportId: string, knownViewports: string[]) {
    const known =
      knownViewports.length > 0 ? knownViewports.map((v) => `"${v}"`).join(", ") : "(none)";
    super(
      ScreenErrorCodes.ViewportNotFound,
      `Viewport "${viewportId}" is not registered. Known viewports: ${known}.`,
      {
        hint: __GWEN_DEV__
          ? `Declare "${viewportId}" in gwen.config.ts under the \`viewports\` key, or check the viewport id for typos.`
          : undefined,
      },
    );
    this.name = "ScreenViewportNotFoundError";
    this.viewportId = viewportId;
    this.knownViewports = knownViewports;
  }
}
