/**
 * Engine configuration and runtime stats.
 */

import type { GwenPlugin } from '../engine/gwen-engine';

// ── Configuration ─────────────────────────────────────────────────────────────

/**
 * Core engine configuration — passed to `new Engine(config)` or `defineConfig()`.
 *
 * @example
 * ```ts
 * export default defineConfig({
 *   maxEntities: 10_000,
 *   targetFPS: 60,
 *   plugins: [
 *     physics2D({ gravity: -9.81 }),
 *     new InputPlugin(),
 *     new AudioPlugin(),
 *   ],
 * });
 * ```
 */
export interface EngineConfig {
  /** Maximum number of simultaneously alive entities. Minimum: 100. */
  maxEntities: number;
  /** Target frames per second. Range: [1, 300]. */
  targetFPS: number;
  /** Enable debug logging and sentinel integrity checks. @default false */
  debug?: boolean;
  /** Collect performance statistics each frame. @default true */
  enableStats?: boolean;
  /**
   * Use sparse transform synchronization (RFC-V2-004).
   * Only entities that changed since last frame are copied to the WASM buffer.
   * @default true
   */
  sparseTransformSync?: boolean;

  /**
   * Game loop ownership mode.
   *
   * - `'internal'` (default): GWEN owns `requestAnimationFrame`. Call `engine.start()` to begin.
   * - `'external'`: GWEN never touches RAF. The caller drives the loop by calling
   *   `engine.advance(delta)` each frame (e.g. from R3F's `useFrame`).
   *
   * @default 'internal'
   */
  loop?: 'internal' | 'external';

  /**
   * Maximum delta time (in seconds) passed to a single simulation step.
   *
   * Prevents the simulation from destabilising after tab suspension, debugger pauses,
   * or renderer hiccups. Applied in both `'internal'` and `'external'` loop modes.
   *
   * @default 0.1
   */
  maxDeltaSeconds?: number;

  /**
   * All plugins — TS-only and WASM plugins mixed in declaration order.
   *
   * WASM plugins (those with a `wasm` sub-object) are automatically detected
   * and routed through the async WASM initialisation pipeline by `createEngine()`.
   *
   * @example
   * ```ts
   * plugins: [
   *   physics2D({ gravity: -9.81 }), // WASM — has `wasm` sub-object
   *   new InputPlugin(),              // TS-only
   *   new AudioPlugin(),
   * ]
   * ```
   */
  plugins?: GwenPlugin[];

  /**
   * Number of pre-allocated tween slots.
   * @default 256
   */
  tweenPoolSize?: number;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/**
 * Snapshot of engine runtime metrics — returned by `engine.getStats()`.
 */
export interface EngineStats {
  /** Measured frames per second (updated every 60 frames). */
  fps: number;
  /** Total frames rendered since `engine.start()`. */
  frameCount: number;
  /** Delta time of the last frame in seconds (capped at 0.1 s). */
  deltaTime: number;
  /** Number of currently alive entities. */
  entityCount: number;
  /** `true` if the game loop is currently running. */
  isRunning: boolean;
}
