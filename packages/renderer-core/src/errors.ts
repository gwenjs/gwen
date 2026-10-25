import { GwenError } from "@gwenjs/schema";
/**
 * @file Renderer error codes and error classes.
 *
 * Each class extends {@link GwenError}. `docsUrl` is derived from the code.
 * `hint` is passed only inside `__GWEN_DEV__ ? … : undefined`.
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
  /** A provided `layerManager` is not a `LayerManager` from this package. */
  FOREIGN_LAYER_MANAGER: "RENDERER:FOREIGN_LAYER_MANAGER",
  /** A conformance check failed. */
  CONFORMANCE_FAILED: "RENDERER:CONFORMANCE_FAILED",
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
export class RendererAlreadyRegisteredError extends GwenError {
  override readonly code = RendererErrorCodes.ALREADY_REGISTERED;
  readonly rendererName: string;

  constructor(rendererName: string) {
    super(
      RendererErrorCodes.ALREADY_REGISTERED,
      `"${rendererName}" is already registered. Only one renderer per key is allowed.`,
      {
        hint: __GWEN_DEV__
          ? `Remove the duplicate module entry for "${rendererName}" in gwen.config.ts.`
          : undefined,
      },
    );
    this.name = "RendererAlreadyRegisteredError";
    this.rendererName = rendererName;
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
export class RendererContractVersionError extends GwenError {
  override readonly code = RendererErrorCodes.CONTRACT_VERSION;
  readonly rendererName: string;
  readonly actual: number;
  readonly expected: number;

  constructor(rendererName: string, actual: number, expected: number) {
    super(
      RendererErrorCodes.CONTRACT_VERSION,
      `"${rendererName}" contractVersion ${actual} is incompatible with renderer-core v${expected}.`,
      {
        hint: __GWEN_DEV__
          ? `Update @gwenjs/renderer-core or "${rendererName}" so their versions match.`
          : undefined,
      },
    );
    this.name = "RendererContractVersionError";
    this.rendererName = rendererName;
    this.actual = actual;
    this.expected = expected;
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
export class EmptyLayersError extends GwenError {
  override readonly code = RendererErrorCodes.MISSING_LAYER;
  readonly rendererName: string;

  constructor(rendererName: string) {
    super(
      RendererErrorCodes.MISSING_LAYER,
      `"${rendererName}" declares zero layers. At least one layer is required.`,
      {
        hint: __GWEN_DEV__
          ? `Add at least one layer entry to the "${rendererName}" config, e.g. layers: { game: { order: 10 } }.`
          : undefined,
      },
    );
    this.name = "EmptyLayersError";
    this.rendererName = rendererName;
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
export class SurfaceInvalidError extends GwenError {
  override readonly code = RendererErrorCodes.SURFACE_INVALID;
  readonly rendererName: string;

  constructor(rendererName: string) {
    super(
      RendererErrorCodes.SURFACE_INVALID,
      `"${rendererName}" is a surface renderer and must declare exactly one layer with coordinate "world".`,
      {
        hint: __GWEN_DEV__
          ? `Use a single world layer, for example layers: { scene: { order: 0, coordinate: "world" } }.`
          : undefined,
      },
    );
    this.name = "SurfaceInvalidError";
    this.rendererName = rendererName;
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
export class LayerOrderConflictError extends GwenError {
  override readonly code = RendererErrorCodes.LAYER_ORDER_CONFLICT;
  readonly left: string;
  readonly right: string;
  readonly order: number;

  constructor(left: string, right: string, order: number) {
    super(
      RendererErrorCodes.LAYER_ORDER_CONFLICT,
      `"${left}" and "${right}" both use order ${order}. A surface layer requires every other layer to use a different order.`,
      {
        hint: __GWEN_DEV__ ? "Give a HUD a strictly greater order." : undefined,
      },
    );
    this.name = "LayerOrderConflictError";
    this.left = left;
    this.right = right;
    this.order = order;
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
export class UnknownLayerError extends GwenError {
  override readonly code = RendererErrorCodes.UNKNOWN_LAYER;
  readonly layerName: string;
  readonly rendererName: string;

  constructor(layerName: string, rendererName: string) {
    super(
      RendererErrorCodes.UNKNOWN_LAYER,
      `Layer "${layerName}" not found in "${rendererName}".`,
      {
        hint: __GWEN_DEV__
          ? `Declare a layer named "${layerName}" in gwen.config.ts under the "${rendererName}" module config.`
          : undefined,
      },
    );
    this.name = "UnknownLayerError";
    this.layerName = layerName;
    this.rendererName = rendererName;
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
export class UnavailableCameraError extends GwenError {
  override readonly code = RendererErrorCodes.UNAVAILABLE_CAMERA;
  readonly viewportId: string | undefined;

  constructor(viewportId?: string) {
    super(
      RendererErrorCodes.UNAVAILABLE_CAMERA,
      `No active camera found${viewportId !== undefined ? ` for viewport '${viewportId}'` : ""}.`,
      {
        hint: __GWEN_DEV__
          ? `Ensure a Camera component with active: true exists in the scene${viewportId !== undefined ? ` for viewport '${viewportId}'` : ""}. Check that CameraSystem is registered via useSystem().`
          : undefined,
      },
    );
    this.name = "UnavailableCameraError";
    this.viewportId = viewportId;
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
export class ScreenToWorldPerspectiveError extends GwenError {
  override readonly code = RendererErrorCodes.SCREEN_TO_WORLD_PERSPECTIVE;
  readonly projectionType: string;

  constructor(projectionType: string) {
    super(
      RendererErrorCodes.SCREEN_TO_WORLD_PERSPECTIVE,
      `screenToWorld() cannot be used with "${projectionType}" projection — a screen pixel maps to a ray, not a unique world point.`,
      {
        hint: __GWEN_DEV__
          ? "Use screenToRay() instead — it returns { origin, direction } for use with useRaycast()."
          : undefined,
      },
    );
    this.name = "ScreenToWorldPerspectiveError";
    this.projectionType = projectionType;
  }
}
