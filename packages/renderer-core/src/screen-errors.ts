import { GwenError } from "@gwenjs/schema";
/**
 * @file Screen error codes and error classes.
 *
 * All screen errors carry a `code` (for programmatic matching), a human-readable
 * `hint` (how to fix the issue), and a `docsUrl` (link to documentation).
 * This pattern mirrors {@link RendererAlreadyRegisteredError} from renderer-core.
 */

/** Error codes emitted by the GWEN screen system. */
export const ScreenErrorCodes = {
  /**
   * ResizeObserver is required but not available in this environment.
   * Occurs when running in Node.js or an old browser without a `sizeProvider` configured.
   */
  ResizeObserverNotAvailable: "SCREEN:RESIZE_OBSERVER_NOT_AVAILABLE",
  /**
   * `useScreen()` was called with a viewport id that is not registered
   * in the current `ViewportManager`.
   */
  ViewportNotFound: "SCREEN:VIEWPORT_NOT_FOUND",
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
  readonly hint: string;
  readonly docsUrl: string;

  constructor() {
    super(
      ScreenErrorCodes.ResizeObserverNotAvailable,
      "[GwenScreen] ResizeObserver is not available in this environment. " +
        "Configure `screen.sizeProvider` in gwen.config.ts for non-browser environments.",
    );
    this.name = "ScreenResizeObserverError";
    this.hint =
      "Pass `screen: { sizeProvider: StaticSizeProvider({ width: W, height: H }) }` " +
      "in gwen.config.ts for Node.js or server environments.";
    this.docsUrl = "https://gwenengine.dev/docs/screen#node";
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
  readonly hint: string;
  readonly docsUrl: string;

  constructor(viewportId: string, knownViewports: string[]) {
    super(
      ScreenErrorCodes.ViewportNotFound,
      `[GwenScreen] Viewport "${viewportId}" is not registered. ` +
        `Known viewports: ${knownViewports.length > 0 ? knownViewports.map((v) => `"${v}"`).join(", ") : "(none)"}.`,
    );
    this.name = "ScreenViewportNotFoundError";
    this.viewportId = viewportId;
    this.knownViewports = knownViewports;
    this.hint =
      `Declare "${viewportId}" in gwen.config.ts under the \`viewports\` key, ` +
      `or check the viewport id for typos.`;
    this.docsUrl = "https://gwenengine.dev/docs/screen#viewports";
  }
}
