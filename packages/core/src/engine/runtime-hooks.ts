import type { EntityId } from './engine-api.js';

/**
 * Payload emitted with the `engine:error` hook when the frame loop catches an error.
 *
 * @example
 * ```typescript
 * engine.hooks.hook('engine:error', (payload) => {
 *   console.error(`[${payload.code}] ${payload.message}`, payload.cause)
 * })
 * ```
 */
export interface EngineErrorPayload {
  /** Error code identifying the failure (e.g., `CORE:FRAME_LOOP_ERROR`). */
  readonly code: string;
  /** Human-readable message describing the error. */
  readonly message: string;
  /** The original thrown value, if any. */
  readonly cause?: unknown;
  /** Frame counter at the time of the error. */
  readonly frame?: number;
}

/**
 * Base runtime hook map for the GWEN engine.
 *
 * Extended by plugin packages via TypeScript declaration merging.
 *
 * @example Augmenting with plugin hooks
 * ```typescript
 * // In a plugin package's index.d.ts:
 * declare module '@gwenjs/core' {
 *   interface GwenRuntimeHooks {
 *     'my:event': (payload: MyPayload) => void
 *   }
 * }
 * ```
 */
export interface GwenRuntimeHooks {
  /** Fired once when `engine.start()` is called, after all plugins are set up. */
  'engine:init': () => void;
  /** Fired once when `engine.start()` begins the RAF loop. */
  'engine:start': () => void;
  /** Fired once when `engine.stop()` tears down the engine. */
  'engine:stop': () => void;
  /** Fired after a plugin completes its `setup()` and is registered in the engine. */
  'plugin:registered': (pluginName: string) => void;
  /** Fired at the start of every tick, before any phase runs. */
  'engine:tick': (dt: number) => void;
  /** Fired at the end of every tick, after the render phase. */
  'engine:afterTick': (dt: number) => void;
  /** Fired when a new entity is created. */
  'entity:spawn': (id: EntityId) => void;
  /** Fired when an entity is destroyed. */
  'entity:destroy': (id: EntityId) => void;
  /** Fired when the frame loop catches an unhandled error. */
  'engine:error': (payload: EngineErrorPayload) => void;

  /**
   * Fired when a plugin lifecycle hook throws and the error is not recovered
   * via `context.recover()`.
   *
   * @example
   * ```typescript
   * engine.hooks.hook('plugin:error', ({ pluginName, phase, error }) => {
   *   analytics.track('plugin_crash', { pluginName, phase })
   * })
   * ```
   */
  'plugin:error': (payload: {
    pluginName: string;
    phase: 'setup' | 'onBeforeUpdate' | 'onUpdate' | 'onAfterUpdate' | 'onRender' | 'teardown';
    error: unknown;
    frame: number;
  }) => void;

  /**
   * Fired to trigger plugin-specific setup when an entity is created from a
   * prefab declaration. Pass the entity id and the prefab's `extensions` map.
   * Plugins (e.g. Physics2D) subscribe to this to create rigid bodies, etc.
   */
  'prefab:instantiate': (
    entityId: EntityId,
    extensions: Readonly<Partial<GwenPrefabExtensions>>,
  ) => void;
}
