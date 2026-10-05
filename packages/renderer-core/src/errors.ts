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
  /**
   * Two layers share an order. Layer renderers warn.
   * A surface layer with the same order as any other layer throws {@link LayerOrderConflictError}.
   */
  LAYER_ORDER_CONFLICT: "RENDERER:LAYER_ORDER_CONFLICT",
  /** A renderer declared zero layers — at least one layer is required. */
  MISSING_LAYER: "RENDERER:MISSING_LAYER",
  /** A surface renderer did not declare exactly one `coordinate: "world"` layer. */
  SURFACE_INVALID: "RENDERER:SURFACE_INVALID",
  /** Camera not available */
  UNAVAILABLE_CAMERA: "RENDERER:UNAVAILABLE_CAMERA",
  /** Projection not supported for screen to world*/
  SCREEN_TO_WORLD_PERSPECTIVE: "RENDERER:SCREEN_TO_WORLD_PERSPECTIVE",
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
 * Thrown when a surface renderer does not declare exactly one world layer.
 *
 * @example
 * ```ts
 * throw new SurfaceInvalidError('renderer:three')
 * ```
 */
export class SurfaceInvalidError extends Error {
  readonly code = RendererErrorCodes.SURFACE_INVALID;
  readonly rendererName: string;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(rendererName: string) {
    super(
      `[GwenRenderer] "${rendererName}" is a surface renderer and must declare exactly one layer with coordinate "world".`,
    );
    this.name = "SurfaceInvalidError";
    this.rendererName = rendererName;
    this.hint = `Use a single world layer, for example layers: { scene: { order: 0, coordinate: "world" } }.`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#surface";
  }
}

/**
 * Thrown when a surface layer shares its `order` with any other layer.
 * HUD layers must use a strictly greater order than the surface.
 *
 * @example
 * ```ts
 * throw new LayerOrderConflictError('renderer:three:scene', 'renderer:html:hud', 0)
 * ```
 */
export class LayerOrderConflictError extends Error {
  readonly code = RendererErrorCodes.LAYER_ORDER_CONFLICT;
  readonly left: string;
  readonly right: string;
  readonly order: number;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(left: string, right: string, order: number) {
    super(
      `[GwenRenderer] [${RendererErrorCodes.LAYER_ORDER_CONFLICT}] "${left}" and "${right}" both use order ${order}. A surface layer requires every other layer to use a different order. Give a HUD a strictly greater order.`,
    );
    this.name = "LayerOrderConflictError";
    this.left = left;
    this.right = right;
    this.order = order;
    this.hint = `Raise the HUD layer order above the surface layer order.`;
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

/**
 * Thrown when {@link screenToWorld} or {@link screenToRay} cannot find an active
 * camera — either because no camera exists in the scene, or because the given
 * viewport id is not bound to any active camera.
 *
 * @example
 * ```ts
 * // Ensure CameraSystem is registered and a Camera entity is active:
 * useSystem(CameraSystem)
 *
 * const cam = defineActor(CameraActor, () => {
 *   const camera = useCamera({ active: true, viewportId: 'main' })
 * })
 * ```
 *
 * @see {@link screenToWorld}
 * @see {@link screenToRay}
 */
export class UnavailableCameraError extends Error {
  readonly code = RendererErrorCodes.UNAVAILABLE_CAMERA;
  readonly viewportId: string | undefined;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(viewportId?: string) {
    super(
      `[GwenRenderer] No active camera found${viewportId !== undefined ? ` for viewport '${viewportId}'` : ""}.`,
    );
    this.name = "UnavailableCameraError";
    this.viewportId = viewportId;
    this.hint = `Ensure a Camera component with active: true exists in the scene${viewportId !== undefined ? ` for viewport '${viewportId}'` : ""}. Check that CameraSystem is registered via useSystem().`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#cameras";
  }
}

/**
 * Thrown when {@link screenToWorld} is called with a perspective camera.
 * Perspective projection maps a screen pixel to a ray, not a unique world point.
 *
 * @example
 * ```ts
 * // Instead of screenToWorld(), use screenToRay():
 * const { origin, direction } = screenToRay(px, py)
 * const hit = useRaycast({ origin, direction })
 * ```
 *
 * @see {@link screenToRay} — returns `{ origin, direction }` for perspective cameras
 */
export class ScreenToWorldPerspectiveError extends Error {
  readonly code = RendererErrorCodes.SCREEN_TO_WORLD_PERSPECTIVE;
  readonly projectionType: string;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(projectionType: string) {
    super(
      `[GwenRenderer] screenToWorld() cannot be used with "${projectionType}" projection — a screen pixel maps to a ray, not a unique world point.`,
    );
    this.name = "ScreenToWorldPerspectiveError";
    this.projectionType = projectionType;
    this.hint = `Use screenToRay() instead — it returns { origin, direction } for use with useRaycast().`;
    this.docsUrl = "https://gwenengine.dev/docs/renderer#screen-to-world";
  }
}
