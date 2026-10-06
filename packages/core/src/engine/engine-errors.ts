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
  ENTITY_LIMIT_REACHED: "CORE:ENTITY_LIMIT_REACHED",
  COMPONENT_TYPE_LIMIT_REACHED: "CORE:COMPONENT_TYPE_LIMIT_REACHED",
  INVALID_PARENT: "CORE:INVALID_PARENT",
  INVALID_MAX_ENTITIES: "CORE:INVALID_MAX_ENTITIES",
  BUFFER_LENGTH_MISMATCH: "CORE:BUFFER_LENGTH_MISMATCH",
  INVALID_COMPONENT_SCHEMA: "CORE:INVALID_COMPONENT_SCHEMA",
  WASM_MODULE_REGION_TOO_SMALL: "CORE:WASM_MODULE_REGION_TOO_SMALL",
  WASM_MODULE_REGION_INVALID: "CORE:WASM_MODULE_REGION_INVALID",
  INVALID_SHARED_BUFFER: "CORE:INVALID_SHARED_BUFFER",
  UNCAUGHT_ERROR: "CORE:UNCAUGHT_ERROR",
  UNHANDLED_REJECTION: "CORE:UNHANDLED_REJECTION",
  /** Logged when an `on` / `onFatal` / hook handler throws. Never emitted on the bus. */
  ERROR_HANDLER_FAILED: "CORE:ERROR_HANDLER_FAILED",
  MEMORY_VIEW_INVALID: "CORE:MEMORY_VIEW_INVALID",
  MEMORY_VIEW_DETACHED: "CORE:MEMORY_VIEW_DETACHED",
  WASM_NOT_INITIALIZED: "CORE:WASM_NOT_INITIALIZED",
  WASM_VARIANT_MISMATCH: "CORE:WASM_VARIANT_MISMATCH",
  SHARED_BUFFER_ALLOC_FAILED: "CORE:SHARED_BUFFER_ALLOC_FAILED",
  SHARED_MEMORY_INVALID_SIZE: "CORE:SHARED_MEMORY_INVALID_SIZE",
  SHARED_MEMORY_EXHAUSTED: "CORE:SHARED_MEMORY_EXHAUSTED",
  SHARED_MEMORY_SENTINEL_OVERWRITE: "CORE:SHARED_MEMORY_SENTINEL_OVERWRITE",
  INVALID_ENTITY_ID: "CORE:INVALID_ENTITY_ID",
  WASM_API_VERSION_MISMATCH: "CORE:WASM_API_VERSION_MISMATCH",
  INVALID_COMPONENT_TYPE: "CORE:INVALID_COMPONENT_TYPE",
  INVALID_SCENE_ROUTE: "CORE:INVALID_SCENE_ROUTE",
  ADVANCE_REENTRANT: "CORE:ADVANCE_REENTRANT",
  INVALID_STATE_TRANSITION: "CORE:INVALID_STATE_TRANSITION",
  WASM_MODULE_NO_MEMORY: "CORE:WASM_MODULE_NO_MEMORY",
  WASM_REGION_NOT_FOUND: "CORE:WASM_REGION_NOT_FOUND",
  WASM_CHANNEL_NOT_FOUND: "CORE:WASM_CHANNEL_NOT_FOUND",
  WASM_MODULE_NOT_FOUND: "CORE:WASM_MODULE_NOT_FOUND",
  OUTSIDE_CLEANUP_CONTEXT: "CORE:OUTSIDE_CLEANUP_CONTEXT",
  OUTSIDE_ENGINE_CONTEXT: "CORE:OUTSIDE_ENGINE_CONTEXT",
  ACTOR_POOL_EXHAUSTED: "CORE:ACTOR_POOL_EXHAUSTED",
} as const;

/**
 * Codes a core WASM export puts on the thrown `Error`.
 * Panic is not in this set: a trap is `GwenWasmPanicError`, not `GwenWasmError`.
 */
export type CoreWasmErrorCode =
  | typeof CoreErrorCodes.ENTITY_LIMIT_REACHED
  | typeof CoreErrorCodes.QUERY_CAPACITY_EXCEEDED
  | typeof CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED
  | typeof CoreErrorCodes.INVALID_PARENT
  | typeof CoreErrorCodes.INVALID_MAX_ENTITIES
  | typeof CoreErrorCodes.BUFFER_LENGTH_MISMATCH
  | typeof CoreErrorCodes.INVALID_SHARED_BUFFER;

const CORE_WASM_ERROR_CODE_LIST: readonly CoreWasmErrorCode[] = [
  CoreErrorCodes.ENTITY_LIMIT_REACHED,
  CoreErrorCodes.QUERY_CAPACITY_EXCEEDED,
  CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED,
  CoreErrorCodes.INVALID_PARENT,
  CoreErrorCodes.INVALID_MAX_ENTITIES,
  CoreErrorCodes.BUFFER_LENGTH_MISMATCH,
  CoreErrorCodes.INVALID_SHARED_BUFFER,
];

/** True when `code` is one of the recoverable core WASM codes. */
export function isCoreWasmErrorCode(code: unknown): code is CoreWasmErrorCode {
  return typeof code === "string" && CORE_WASM_ERROR_CODE_LIST.some((known) => known === code);
}

/**
 * Recoverable failure of one core WASM export.
 *
 * The type parameter defaults to `` `CORE:${string}` `` so other packages can
 * instantiate it with their own code union. Core never names a physics code.
 */
export class GwenWasmError<C extends string = `CORE:${string}`> extends GwenError {
  override readonly code: C;
  readonly exportName: string;
  readonly cause: unknown;

  constructor(code: C, message: string, exportName: string, cause: unknown) {
    super(code, message);
    this.name = "GwenWasmError";
    this.code = code;
    this.exportName = exportName;
    this.cause = cause;
  }
}

/**
 * A core WASM trap. This does not extend {@link GwenWasmError}: a catch of the
 * recoverable class must not swallow a panic.
 */
export class GwenWasmPanicError extends GwenError {
  override readonly code: typeof CoreErrorCodes.WASM_PANIC;
  readonly exportName: string | undefined;
  readonly cause: WebAssembly.RuntimeError;

  constructor(exportName: string | undefined, cause: WebAssembly.RuntimeError) {
    super(CoreErrorCodes.WASM_PANIC, cause.message);
    this.name = "GwenWasmPanicError";
    this.code = CoreErrorCodes.WASM_PANIC;
    this.exportName = exportName;
    this.cause = cause;
  }
}

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
