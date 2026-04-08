/**
 * @file Renderer error codes and error classes.
 *
 * All renderer errors carry a `code` (for programmatic matching), a human-readable
 * `hint` (how to fix the issue), and a `docsUrl` (link to documentation).
 * This pattern mirrors {@link GwenPluginNotFoundError} from `@gwenjs/core`.
 */

/** Error codes emitted by the GWEN renderer system. */
export const RendererErrorCodes = {
  /** A renderer with this name is already registered in the engine. */
  ALREADY_REGISTERED: "RENDERER:ALREADY_REGISTERED",
  /** The renderer's contractVersion does not match RENDERER_CONTRACT_VERSION. */
  CONTRACT_VERSION: "RENDERER:CONTRACT_VERSION",
  /** A composable referenced a layer name not declared in the renderer config. */
  UNKNOWN_LAYER: "RENDERER:UNKNOWN_LAYER",
  /** Two layers across different renderers share the same order value (warn only). */
  LAYER_ORDER_CONFLICT: "RENDERER:LAYER_ORDER_CONFLICT",
  /** A renderer declared zero layers — at least one layer is required. */
  MISSING_LAYER: "RENDERER:MISSING_LAYER",
} as const;

/** Union of all renderer error code string literals. */
export type RendererErrorCode = (typeof RendererErrorCodes)[keyof typeof RendererErrorCodes];

/**
 * Thrown when a renderer is registered under a key that is already in use.
 *
 * @example
 * ```ts
 * throw new RendererAlreadyRegisteredError('renderer:canvas')
 * ```
 */
export class RendererAlreadyRegisteredError extends Error {
  readonly code = RendererErrorCodes.ALREADY_REGISTERED;
  readonly rendererName: string;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(rendererName: string) {
    super(
      `[GwenRenderer] "${rendererName}" is already registered. Only one renderer per key is allowed.`,
    );
    this.name = "RendererAlreadyRegisteredError";
    this.rendererName = rendererName;
    this.hint = `Remove the duplicate module entry for "${rendererName}" in gwen.config.ts.`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#errors";
  }
}

/**
 * Thrown when a renderer's contractVersion does not match RENDERER_CONTRACT_VERSION.
 *
 * @example
 * ```ts
 * throw new RendererContractVersionError('renderer:canvas', actual, expected)
 * ```
 */
export class RendererContractVersionError extends Error {
  readonly code = RendererErrorCodes.CONTRACT_VERSION;
  readonly rendererName: string;
  readonly actual: number;
  readonly expected: number;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(rendererName: string, actual: number, expected: number) {
    super(
      `[GwenRenderer] "${rendererName}" contractVersion ${actual} is incompatible with renderer-core v${expected}.`,
    );
    this.name = "RendererContractVersionError";
    this.rendererName = rendererName;
    this.actual = actual;
    this.expected = expected;
    this.hint = `Update @gwenjs/renderer-core or "${rendererName}" so their versions match.`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#versioning";
  }
}

/**
 * Thrown when a renderer is registered with zero layers.
 *
 * @example
 * ```ts
 * throw new EmptyLayersError('renderer:canvas')
 * ```
 */
export class EmptyLayersError extends Error {
  readonly code = RendererErrorCodes.MISSING_LAYER;
  readonly rendererName: string;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(rendererName: string) {
    super(`[GwenRenderer] "${rendererName}" declares zero layers. At least one layer is required.`);
    this.name = "EmptyLayersError";
    this.rendererName = rendererName;
    this.hint = `Add at least one layer entry to the "${rendererName}" config, e.g. layers: { game: { order: 10 } }.`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#layers";
  }
}

/**
 * Thrown when a composable references a layer name that was not declared in the renderer config.
 *
 * @example
 * ```ts
 * throw new UnknownLayerError('hud', 'renderer:html')
 * ```
 */
export class UnknownLayerError extends Error {
  readonly code = RendererErrorCodes.UNKNOWN_LAYER;
  readonly layerName: string;
  readonly rendererName: string;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(layerName: string, rendererName: string) {
    super(`[GwenRenderer] Layer "${layerName}" not found in "${rendererName}".`);
    this.name = "UnknownLayerError";
    this.layerName = layerName;
    this.rendererName = rendererName;
    this.hint = `Declare a layer named "${layerName}" in gwen.config.ts under the "${rendererName}" module config.`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#layers";
  }
}
