import type { EntityId } from "./engine-api.js";
import type { EngineStateChange } from "./engine-types.js";

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
    /** Fired after every lifecycle transition. */
    "engine:state-change": (payload: EngineStateChange) => void;
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
    /** Fired at Phase 2 of the frame loop — before physics. Replaces plugin.onBeforeUpdate(). */
    "engine:before-update": (dt: number) => void;
    /** Fired at Phase 6 of the frame loop — after physics. Replaces plugin.onUpdate(). */
    "engine:update": (dt: number) => void;
    /** Fired at Phase 7a of the frame loop — after update. Replaces plugin.onAfterUpdate(). */
    "engine:after-update": (dt: number) => void;
    /** Fired at Phase 7b of the frame loop — render pass. Replaces plugin.onRender(). */
    "engine:render": () => void;
    /** Fired by the router when a scene becomes active. Payload: scene name + optional navigation params. */
    "scene:enter": (name: string, params?: Record<string, unknown>) => void;
    /** Fired by the router before leaving a scene. Payload: scene name. */
    "scene:beforeLeave": (name: string) => void;
    /** Fired by the router after a scene is fully left. Payload: scene name. */
    "scene:leave": (name: string) => void;
    /**
     * Fired by the router before the leave animation. Async — awaited before
     * `scene:beforeLeave`. Payload: { from, to }.
     */
    "scene:transition:leave": (payload: { from: string; to: string }) => void | Promise<void>;
    /**
     * Fired by the router after `scene:enter`. Async — awaited after scene is active.
     * Payload: { from, to }.
     */
    "scene:transition:enter": (payload: { from: string; to: string }) => void | Promise<void>;
    /** Fired when an actor scope is resumed (pool re-acquire or explicit enable). */
    "actor:enable": (entityId: bigint) => void;
    /** Fired when an actor scope is paused (pool release or explicit disable). */
    "actor:disable": (entityId: bigint) => void;

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
