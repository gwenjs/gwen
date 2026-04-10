/**
 * @file Core type contracts for the GWEN renderer plugin system.
 *
 * These interfaces define the surface area every renderer plugin must implement
 * and the handles every composable must return. They are the shared language
 * between renderer-core, renderer plugins, and game code.
 *
 * @see {@link RendererService} — the interface each renderer plugin implements
 * @see {@link SpriteHandle} — returned by useSprite()
 * @see {@link HTMLHandle} — returned by useHTML()
 * @see {@link MeshHandle} — returned by useMesh() / useR3F()
 */

import type { RendererStatsCollector } from "./stats.js";

/** Current renderer contract version. Bump on breaking changes to RendererService. */
export const RENDERER_CONTRACT_VERSION = 1;

/**
 * Declares a single named rendering slot within a renderer plugin.
 *
 * @example
 * ```ts
 * const layers = {
 *   background: { order: 0, coordinate: 'screen' },
 *   game:       { order: 10 },
 *   hud:        { order: 100, coordinate: 'screen' },
 * }
 * ```
 */
export interface LayerDef {
  /**
   * Rendering depth. Lower values render first (behind). Higher values render last (in front).
   * Must be unique across ALL registered renderers — LayerManager warns on conflicts.
   */
  order: number;
  /**
   * Coordinate space for this layer.
   * - `'screen'` — positions are in CSS pixels relative to the viewport (default)
   * - `'world'`  — positions are in world units; the renderer must project them to screen space
   * @default 'screen'
   */
  coordinate?: "world" | "screen";
  /**
   * Whether this layer belongs to a specific viewport or is rendered globally.
   *
   * - `'viewport'` — the layer is instanced once per viewport and receives the
   *   corresponding camera transform. Default for `coordinate: 'world'` layers.
   * - `'global'` — the layer is mounted once for the entire screen (e.g. a HUD
   *   that sits above all viewports). Default for `coordinate: 'screen'` layers.
   *
   * @default `'viewport'` when `coordinate === 'world'`, `'global'` otherwise
   */
  scope?: "viewport" | "global";
}

/**
 * The interface every GWEN renderer plugin must implement.
 *
 * Register the implementation via `engine.provide('renderer:<name>', service)`.
 * The LayerManager validates the contract version and mounts the DOM elements.
 *
 * @example
 * ```ts
 * class MyRendererService implements RendererService {
 *   readonly name = 'renderer:my'
 *   readonly contractVersion = RENDERER_CONTRACT_VERSION
 *   readonly layers = { game: { order: 10 } }
 *   mount(container: HTMLElement) { ... }
 *   unmount() { ... }
 *   resize(w: number, h: number) { ... }
 *   getLayerElement(name: string): HTMLElement { ... }
 * }
 * ```
 */
export interface RendererService {
  /** Unique key matching the GwenProvides declaration (e.g. `'renderer:canvas'`). */
  readonly name: string;
  /**
   * Must equal {@link RENDERER_CONTRACT_VERSION}.
   * LayerManager throws {@link RendererContractVersionError} on mismatch.
   */
  readonly contractVersion: number;
  /**
   * Named layers managed by this renderer. At least one layer is required.
   * Each entry becomes a DOM element mounted by LayerManager.
   */
  readonly layers: Record<string, LayerDef>;
  /**
   * Called by LayerManager after all layer DOM elements have been inserted into
   * the shared root container. The `container` argument is that shared root —
   * use it to read dimensions, attach resize observers, or initialise a WebGL
   * context that targets the full viewport.
   * @param container - The shared root container passed to LayerManager.
   */
  mount(container: HTMLElement): void;
  /** Called by LayerManager when the engine shuts down. Must free all resources. */
  unmount(): void;
  /**
   * Called by LayerManager whenever the game viewport is resized.
   * @param width  - New width in CSS pixels.
   * @param height - New height in CSS pixels.
   */
  resize(width: number, height: number): void;
  /**
   * Returns the DOM element (HTMLElement or HTMLCanvasElement) for a named layer.
   * Throws {@link UnknownLayerError} if `layerName` was not declared in `layers`.
   * @param layerName - A key from the `layers` record.
   */
  getLayerElement(layerName: string): HTMLElement | HTMLCanvasElement;
  /**
   * Optional. Called by LayerManager after mount() to inject the stats collector.
   * When provided, the renderer should call `collector.reportLayer()` each frame.
   * Only called when `import.meta.env.DEV || engine.debug` is true.
   */
  setStatsCollector?(collector: RendererStatsCollector): void;
}

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
