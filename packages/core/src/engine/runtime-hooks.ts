import type { EntityId } from "./engine-api.js";

// Re-export so existing `import { GwenRuntimeHooks } from '@gwenjs/core'` still works.
export type { GwenRuntimeHooks } from "@gwenjs/schema";

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
 * Core engine runtime hooks — augments `GwenRuntimeHooks` in `@gwenjs/schema`.
 *
 * Plugin packages add their own hooks the same way:
 * ```typescript
 * declare module "@gwenjs/schema" {
 *   interface GwenRuntimeHooks {
 *     "my-plugin:event": (payload: MyPayload) => void;
 *   }
 * }
 * ```
 */
declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    /** Fired once when `engine.start()` is called, after all plugins are set up. */
    "engine:init": () => void;
    /** Fired once when `engine.start()` begins the RAF loop. */
    "engine:start": () => void;
    /** Fired once when `engine.stop()` tears down the engine. */
    "engine:stop": () => void;
    /** Fired after a plugin completes its `setup()` and is registered in the engine. */
    "plugin:registered": (pluginName: string) => void;
    /** Fired at the start of every tick, before any phase runs. */
    "engine:tick": (dt: number) => void;
    /** Fired at the end of every tick, after the render phase. */
    "engine:afterTick": (dt: number) => void;
    /** Fired when a new entity is created. */
    "entity:spawn": (id: EntityId) => void;
    /** Fired when an entity is destroyed. */
    "entity:destroy": (id: EntityId) => void;
    /** Fired when the frame loop catches an unhandled error. */
    "engine:error": (payload: EngineErrorPayload) => void;

    /**
     * Fired when a plugin lifecycle hook throws and the error is not recovered
     * via `context.recover()`.
     */
    "plugin:error": (payload: {
      pluginName: string;
      phase: "setup" | "onBeforeUpdate" | "onUpdate" | "onAfterUpdate" | "onRender" | "teardown";
      error: unknown;
      frame: number;
    }) => void;

    /**
     * Fired to trigger plugin-specific setup when an entity is created from a
     * prefab declaration. Plugins (e.g. Physics2D) subscribe to create rigid bodies.
     */
    "prefab:instantiate": (
      entityId: EntityId,
      extensions: Readonly<Partial<GwenPrefabExtensions>>,
    ) => void;
  }
}
