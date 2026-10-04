/**
 * @file Engine error types and error codes.
 *
 * Extracted from gwen-engine.ts — pure type/class definitions with no runtime
 * engine dependencies. Safe to import without pulling in the full engine module.
 */

import { GwenError } from "@gwenjs/schema";

// ─── Error options ──────────────────────────────────────────────────────────

/**
 * Options object accepted by the {@link GwenPluginNotFoundError} constructor.
 * Use this form when constructing the error from plugin composables.
 */
export interface GwenPluginNotFoundErrorOptions {
  /** The npm package name of the missing plugin. */
  pluginName: string;
  /** Human-readable hint explaining how to fix the issue. */
  hint: string;
  /** URL to the plugin's documentation. */
  docsUrl: string;
}

export class GwenPluginNotFoundError extends GwenError {
  readonly pluginName: string;
  readonly hint: string;
  readonly docsUrl: string;

  constructor(opts: GwenPluginNotFoundErrorOptions) {
    const hint =
      opts.hint || `Add the "${opts.pluginName}" plugin via engine.use() or in gwen.config.ts.`;
    const docsUrl = opts.docsUrl || "https://gwenengine.dev/docs/plugins";
    super(
      "GWEN_PLUGIN_NOT_FOUND",
      `[GwenEngine] Plugin/service "${opts.pluginName}" not found. ${hint}`,
    );
    this.name = "GwenPluginNotFoundError";
    this.pluginName = opts.pluginName;
    this.hint = hint;
    this.docsUrl = docsUrl;
  }
}

// ─── Plugin error context ───────────────────────────────────────────────────

/**
 * Context passed to a plugin's {@link GwenPlugin.onError} hook.
 */
export interface PluginErrorContext {
  /** Frame loop phase in which the error occurred. */
  phase: "setup" | "onBeforeUpdate" | "onUpdate" | "onAfterUpdate" | "onRender" | "teardown";
  /** Engine frame index at the time of the error. */
  frame: number;
  /**
   * Mark this error as handled.
   * When called, the error is **not** forwarded to the engine error bus.
   * The frame continues normally.
   */
  recover(): void;
}

// ─── Error codes ────────────────────────────────────────────────────────────

/** Error codes emitted by the GWEN core engine. */
export const CoreErrorCodes = {
  FRAME_LOOP_ERROR: "CORE:FRAME_LOOP_ERROR",
  PLUGIN_SETUP_ERROR: "CORE:PLUGIN_SETUP_ERROR",
  PLUGIN_RUNTIME_ERROR: "CORE:PLUGIN_RUNTIME_ERROR",
  WASM_LOAD_ERROR: "CORE:WASM_LOAD_ERROR",
  WASM_TIMEOUT: "CORE:WASM_TIMEOUT",
  WASM_PANIC: "CORE:WASM_PANIC",
  QUERY_CAPACITY_EXCEEDED: "CORE:QUERY_CAPACITY_EXCEEDED",
  /** D7 wasm test requires this exact string, with no `CORE:` prefix. */
  ENTITY_LIMIT_REACHED: "ENTITY_LIMIT_REACHED",
} as const;

/** Error codes emitted by the GWEN actor system. */
export const ActorErrorCodes = {
  PLUGIN_NOT_READY: "ACTOR:PLUGIN_NOT_READY",
  /** A PublicAPI method was called via the `useActor` handle but no live instance exists. */
  NO_LIVE_INSTANCE: "ACTOR:NO_LIVE_INSTANCE",
  /** Circular actor ownership detected via `useChildren()`. */
  CIRCULAR_OWNERSHIP: "ACTOR:CIRCULAR_OWNERSHIP",
} as const;

/**
 * Thrown when an actor operation is attempted before the actor's plugin has
 * been installed with `engine.use()`.
 *
 * @example
 * ```ts
 * if (err instanceof GwenActorError && err.code === 'ACTOR:PLUGIN_NOT_READY') {
 *   // actor plugin was not installed before spawning
 * }
 * ```
 */
export class GwenActorError extends GwenError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "GwenActorError";
  }
}

// ─── Composable error ───────────────────────────────────────────────────────

/**
 * Error codes emitted by GWEN composables when called outside their valid context.
 *
 * Use these codes with `instanceof GwenComposableError` to distinguish composable
 * misuse from actor lifecycle errors or engine errors.
 */
export const ComposableErrorCodes = {
  /** Composable called outside an active `defineActor()` factory. */
  OUTSIDE_ACTOR_CONTEXT: "COMPOSABLE:OUTSIDE_ACTOR_CONTEXT",
  /** Composable called outside an active engine context. */
  OUTSIDE_ENGINE_CONTEXT: "COMPOSABLE:OUTSIDE_ENGINE_CONTEXT",
  /** Composable called outside a `defineLayout()` factory. */
  OUTSIDE_LAYOUT_CONTEXT: "COMPOSABLE:OUTSIDE_LAYOUT_CONTEXT",
} as const;

/**
 * Thrown when a composable is called outside its valid context.
 *
 * All GWEN composables (`useEntityId`, `useComponent`, `onStart`, `onDestroy`,
 * `onEvent`, etc.) throw this error when invoked at the wrong lifecycle phase.
 * Catch it with `instanceof GwenComposableError` to handle composable misuse
 * independently from engine or actor errors.
 *
 * @example
 * ```ts
 * try {
 *   useEntityId(); // called outside a factory
 * } catch (e) {
 *   if (e instanceof GwenComposableError) {
 *     console.error('Composable misuse:', e.code, e.message);
 *   }
 * }
 * ```
 */
export class GwenComposableError extends GwenError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "GwenComposableError";
  }
}

/**
 * All error code namespaces exported from a single entry point.
 * Import from `@gwenjs/core` rather than from internal paths.
 */
export const ErrorCodes = {
  Actor: ActorErrorCodes,
  Composable: ComposableErrorCodes,
} as const;
