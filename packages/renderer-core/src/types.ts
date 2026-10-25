/**
 * @file Composable handles for the GWEN renderer plugin system.
 *
 * The renderer contract (`RendererService`, `LayerDef`, `RenderView`, and the
 * contract version) lives in `@gwenjs/schema` and is re-exported here.
 * The handles below are what the composables return.
 *
 * @see {@link RendererService} — the interface each renderer plugin implements
 * @see {@link SpriteHandle} — returned by useSprite()
 * @see {@link HTMLHandle} — returned by useHTML()
 * @see {@link MeshHandle} — returned by useMesh() / useR3F()
 */

export { RENDERER_CONTRACT_VERSION } from "@gwenjs/schema";
export type {
  LayerDef,
  RenderView,
  RendererKind,
  RendererService,
  SurfaceRendererService,
} from "@gwenjs/schema";

// ─── Composable handles ──────────────────────────────────────────────────────

/** Options for sprite animation clips. */
export interface AnimOpts {
  /** Whether the clip loops. @default true */
  loop?: boolean;
  /** Frames per second. Overrides the clip's declared fps if provided. */
  fps?: number;
}

/**
 * Handle returned by `useSprite()`. Controls a sprite instance tied to one entity.
 * The renderer manages the actual draw call; this handle controls state only.
 */
export interface SpriteHandle {
  /** Play a named animation clip. No-op if the clip name is unknown. */
  play(clip: string, opts?: AnimOpts): void;
  /** Stop the current animation and hold on the last frame. */
  stop(): void;
  /** Show or hide this sprite without destroying it. @default true */
  setVisible(visible: boolean): void;
  /**
   * Move this sprite to a different layer at runtime.
   * Throws {@link UnknownLayerError} if the target layer does not exist.
   */
  setLayer(layerName: string): void;
  /** Remove this sprite from the renderer batch. Must be called in onDestroy(). */
  destroy(): void;
}

/**
 * Handle returned by `useHTML()`. Manages a DOM subtree tied to one entity.
 */
export interface HTMLHandle {
  /**
   * Mount a React/Preact/Solid element, an HTML template string, or a plain HTMLElement
   * into this handle's container. Replaces any existing content.
   */
  mount(content: unknown): void;
  /**
   * Pass updated props to the mounted component. The renderer decides how to apply them
   * (re-render, attribute update, etc.). No-op if nothing is mounted.
   */
  update(props: Record<string, unknown>): void;
  /** Show or hide the container without unmounting. @default true */
  setVisible(visible: boolean): void;
  /**
   * Project world-space coordinates to screen-space and position the container.
   * Only meaningful on `coordinate: 'world'` layers.
   * @param x - World X coordinate.
   * @param y - World Y coordinate.
   */
  syncWorldPosition(x: number, y: number): void;
  /** Unmount the component and remove DOM nodes. Must be called in onDestroy(). */
  unmount(): void;
}

/** Controls animation playback on a 3D mesh. */
export interface AnimatorHandle {
  /**
   * Play a named animation clip.
   * @param clip      - Clip name as declared in the asset (e.g. GLTF animation name).
   * @param opts.loop     - Whether the clip loops. @default true
   * @param opts.crossfade - Blend duration in seconds when transitioning from another clip.
   */
  play(clip: string, opts?: { loop?: boolean; crossfade?: number }): void;
  /** Stop all animations immediately. */
  stop(): void;
  /** The currently playing clip name, or null if stopped. */
  readonly currentClip: string | null;
}

/**
 * Handle returned by `useMesh()` / `useR3F()`. Wraps a 3D scene node.
 * The `node` property is renderer-specific (Three.js Object3D, R3F ref, etc.).
 */
export interface MeshHandle {
  /**
   * The underlying renderer node. Type is intentionally opaque — cast to the
   * renderer-specific type when you need direct access (e.g. `ref.current as THREE.Mesh`).
   */
  readonly node: unknown;
  /** Controls animation playback for this mesh. */
  readonly animator: AnimatorHandle;
  /** Show or hide the mesh. @default true */
  setVisible(visible: boolean): void;
  /** Remove this mesh from the scene. Must be called in onDestroy(). */
  destroy(): void;
}
