/**
 * @file Engine error types and error codes.
 *
 * Pure type/class definitions with no runtime
 * engine dependencies. Safe to import without pulling in the full engine module.
 */

import {
  GWEN_PLUGIN_LIFECYCLE_HOOKS,
  GwenError,
  type ForbiddenPluginKey,
  type GwenErrorOptions,
  type GwenPluginRequirement,
} from "@gwenjs/schema";
import { GwenContextErrorCodes } from "@gwenjs/kit";
import type { GwenEngineState } from "./engine-types.js";

/** Lifecycle call rejected by {@link GwenEngineStateError}. */
export type GwenEngineStateMethod =
  | "start"
  | "startExternal"
  | "advance"
  | "stop"
  | "use"
  | "unuse";

// ─── Error options ──────────────────────────────────────────────────────────

/**
 * Options object accepted by the {@link GwenPluginNotFoundError} constructor.
 * Use this form when constructing the error from plugin composables.
 */
export interface GwenPluginNotFoundErrorOptions {
  /** The npm package name or service key of the missing plugin. */
  pluginName: string;
  /** Replaces the default sentence. */
  what?: string;
  /** Human-readable hint explaining how to fix the issue. */
  hint?: string | undefined;
  /** Public name rendered in front of the message. */
  composable?: string;
}

export class GwenPluginNotFoundError extends GwenError {
  readonly pluginName: string;

  constructor(opts: GwenPluginNotFoundErrorOptions) {
    const pluginName = opts.pluginName;
    const what = opts.what ?? `Plugin or service "${pluginName}" is not installed.`;
    super(CoreErrorCodes.PLUGIN_NOT_FOUND, what, {
      ...(opts.composable !== undefined ? { composable: opts.composable } : {}),
      hint: __GWEN_DEV__
        ? (opts.hint ?? `Add the "${pluginName}" plugin via engine.use() or in gwen.config.ts.`)
        : undefined,
    });
    this.name = "GwenPluginNotFoundError";
    this.pluginName = pluginName;
  }
}

/**
 * A plugin requirement is missing at `engine.use`, or `engine.unuse` was asked
 * to remove a plugin that an installed plugin still requires.
 * `missing` and `dependents` are frozen.
 */
export class GwenPluginDependencyError extends GwenError {
  override readonly code:
    | typeof CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING
    | typeof CoreErrorCodes.PLUGIN_IN_USE;
  readonly plugin: string;
  readonly missing: readonly GwenPluginRequirement[];
  readonly dependents: readonly string[];

  constructor(init: {
    code: typeof CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING | typeof CoreErrorCodes.PLUGIN_IN_USE;
    plugin: string;
    missing?: readonly GwenPluginRequirement[];
    dependents?: readonly string[];
  }) {
    const plugin = init.plugin;
    const missing = Object.freeze([...(init.missing ?? [])]);
    const dependents = Object.freeze([...(init.dependents ?? [])]);
    const missingNow = init.code === CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING;
    const listed = missingNow
      ? missing.map((item) => `${item.kind} "${item.name}"`).join(", ")
      : dependents.map((name) => `"${name}"`).join(", ");
    const what = missingNow
      ? `Plugin "${plugin}" requires ${listed}, which is not installed.`
      : `Cannot unuse "${plugin}": required by ${listed}.`;
    super(init.code, what, {
      composable: missingNow ? "engine.use" : "engine.unuse",
      hint: __GWEN_DEV__
        ? missingNow
          ? "Call engine.use() for each missing requirement before the plugin that requires it."
          : "Unuse the dependent plugins first, last installed first."
        : undefined,
    });
    this.name = "GwenPluginDependencyError";
    this.code = init.code;
    this.plugin = plugin;
    this.missing = missing;
    this.dependents = dependents;
  }
}

/**
 * `engine.use` rejected a plugin that declares a lifecycle key.
 * The engine never calls these keys. Register the hook from `setup()`.
 */
export class GwenPluginShapeError extends GwenError {
  override readonly code = CoreErrorCodes.PLUGIN_INVALID_SHAPE;
  readonly plugin: string;
  readonly keys: readonly ForbiddenPluginKey[];

  constructor(name: unknown, badKeys: readonly ForbiddenPluginKey[]) {
    const plugin = typeof name === "string" ? name : "<anonymous>";
    const keys = Object.freeze([...badKeys]);
    const pairs = keys.map((key) => `${GWEN_PLUGIN_LIFECYCLE_HOOKS[key]} for ${key}`).join(" and ");
    const what = `Plugin "${plugin}" declares ${keys.join(", ")}, which the engine never calls; in setup(), hook ${pairs}.`;
    super(CoreErrorCodes.PLUGIN_INVALID_SHAPE, what, {
      composable: "engine.use",
      hint: __GWEN_DEV__
        ? "Move each frame callback into setup() as engine.hooks.hook(<hook>, fn); the hook table is GWEN_PLUGIN_LIFECYCLE_HOOKS."
        : undefined,
    });
    this.name = "GwenPluginShapeError";
    this.plugin = plugin;
    this.keys = keys;
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
  COMPONENT_TYPE_IN_USE: "CORE:COMPONENT_TYPE_IN_USE",
  INVALID_PARENT: "CORE:INVALID_PARENT",
  INVALID_MAX_ENTITIES: "CORE:INVALID_MAX_ENTITIES",
  BUFFER_LENGTH_MISMATCH: "CORE:BUFFER_LENGTH_MISMATCH",
  INVALID_COMPONENT_SCHEMA: "CORE:INVALID_COMPONENT_SCHEMA",
  WASM_MODULE_REGION_TOO_SMALL: "CORE:WASM_MODULE_REGION_TOO_SMALL",
  WASM_MODULE_REGION_INVALID: "CORE:WASM_MODULE_REGION_INVALID",
  INVALID_SHARED_BUFFER: "CORE:INVALID_SHARED_BUFFER",
  COMPONENT_WRITE_REJECTED: "CORE:COMPONENT_WRITE_REJECTED",
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
  WASM_MODULE_ABI_MISMATCH: "CORE:WASM_MODULE_ABI_MISMATCH",
  INVALID_COMPONENT_TYPE: "CORE:INVALID_COMPONENT_TYPE",
  INVALID_SCENE_ROUTE: "CORE:INVALID_SCENE_ROUTE",
  ADVANCE_REENTRANT: "CORE:ADVANCE_REENTRANT",
  INVALID_STATE_TRANSITION: "CORE:INVALID_STATE_TRANSITION",
  WASM_MODULE_NO_MEMORY: "CORE:WASM_MODULE_NO_MEMORY",
  WASM_REGION_NOT_FOUND: "CORE:WASM_REGION_NOT_FOUND",
  WASM_CHANNEL_NOT_FOUND: "CORE:WASM_CHANNEL_NOT_FOUND",
  WASM_MODULE_NOT_FOUND: "CORE:WASM_MODULE_NOT_FOUND",
  OUTSIDE_CLEANUP_CONTEXT: GwenContextErrorCodes.OUTSIDE_CLEANUP_CONTEXT,
  OUTSIDE_ENGINE_CONTEXT: GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT,
  ACTOR_POOL_EXHAUSTED: "CORE:ACTOR_POOL_EXHAUSTED",
  /** `useLayout({ chunkSize })` received a value that is not a positive integer. */
  INVALID_CHUNK_SIZE: "CORE:INVALID_CHUNK_SIZE",
  /** A chunked layout handle was read before its entity was spawned. */
  LAYOUT_HANDLE_NOT_SPAWNED: "CORE:LAYOUT_HANDLE_NOT_SPAWNED",
  /** A non-lazy `useLayout()` load failed and was emitted on the error bus. */
  LAYOUT_LOAD_FAILED: "CORE:LAYOUT_LOAD_FAILED",
  /** Destroying layout entities failed where no caller can receive the error. */
  LAYOUT_DISPOSE_FAILED: "CORE:LAYOUT_DISPOSE_FAILED",
  COMPONENT_LAYOUT_INVALID: "CORE:COMPONENT_LAYOUT_INVALID",
  ARCHETYPE_LIMIT_REACHED: "CORE:ARCHETYPE_LIMIT_REACHED",
  /**
   * The chunk store rejected an empty type list or an unknown handle, or
   * TypeScript rejected a released query, a chunk kept after its loop step
   * (including after the iterator has moved to a later chunk), or an entity
   * row outside the awake prefix.
   */
  QUERY_INVALID: "CORE:QUERY_INVALID",
  /**
   * Dev-only warning on `engine.errors`. Not thrown and not fatal.
   * Once per engine per api (`Query.each` or `useComponentFor`) during a system update phase.
   */
  QUERY_PER_ENTITY_PATH: "CORE:QUERY_PER_ENTITY_PATH",
  /** The chunk store broke an invariant. `site` is in the Rust error. Report the bug. */
  STORAGE_INCONSISTENT: "CORE:STORAGE_INCONSISTENT",
  /** Thrown by `GwenConfigError`. */
  INVALID_CONFIG: "CORE:INVALID_CONFIG",
  /** Thrown by `GwenPluginNotFoundError`. */
  PLUGIN_NOT_FOUND: "CORE:PLUGIN_NOT_FOUND",
  /** Thrown by `GwenPluginShapeError`. */
  PLUGIN_INVALID_SHAPE: "CORE:PLUGIN_INVALID_SHAPE",
  /** `engine.use` rejected because a required plugin or service is not installed. */
  PLUGIN_DEPENDENCY_MISSING: "CORE:PLUGIN_DEPENDENCY_MISSING",
  /** `engine.unuse` rejected: an installed plugin still requires this plugin or one of its services. */
  PLUGIN_IN_USE: "CORE:PLUGIN_IN_USE",
  /** Thrown by `TweenPool.claim`. */
  TWEEN_POOL_EXHAUSTED: "CORE:TWEEN_POOL_EXHAUSTED",
  /** Thrown by `init` when the compiled module does not match its glue contract (#260). */
  WASM_GLUE_MISMATCH: "CORE:WASM_GLUE_MISMATCH",
  /**
   * Thrown by `createEngineLocal().get()` when it would create a value after
   * `engine.stop()` began disposing, and by engine dispose (#261).
   */
  ENGINE_DISPOSED: "CORE:ENGINE_DISPOSED",
  /** `createEngineLocal().get()` received a value that is not an engine. */
  INVALID_ENGINE: "CORE:INVALID_ENGINE",
  /** A `createEngineLocal` `init` read the same local for the engine it is building. */
  ENGINE_LOCAL_REENTRANT: "CORE:ENGINE_LOCAL_REENTRANT",
  /** Thrown by WASM instance capacity (#263). */
  WASM_CAPACITY_EXHAUSTED: "CORE:WASM_CAPACITY_EXHAUSTED",
} as const;

/**
 * Codes a core WASM export puts on the thrown `Error`.
 * Panic is not in this set: a trap is `GwenWasmPanicError`, not `GwenWasmError`.
 */
export type CoreWasmErrorCode =
  | typeof CoreErrorCodes.ENTITY_LIMIT_REACHED
  | typeof CoreErrorCodes.QUERY_CAPACITY_EXCEEDED
  | typeof CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED
  | typeof CoreErrorCodes.COMPONENT_TYPE_IN_USE
  | typeof CoreErrorCodes.INVALID_PARENT
  | typeof CoreErrorCodes.INVALID_MAX_ENTITIES
  | typeof CoreErrorCodes.BUFFER_LENGTH_MISMATCH
  | typeof CoreErrorCodes.INVALID_SHARED_BUFFER
  | typeof CoreErrorCodes.COMPONENT_WRITE_REJECTED
  | typeof CoreErrorCodes.COMPONENT_LAYOUT_INVALID
  | typeof CoreErrorCodes.ARCHETYPE_LIMIT_REACHED
  | typeof CoreErrorCodes.QUERY_INVALID
  | typeof CoreErrorCodes.STORAGE_INCONSISTENT;

const CORE_WASM_ERROR_CODE_LIST: readonly CoreWasmErrorCode[] = [
  CoreErrorCodes.ENTITY_LIMIT_REACHED,
  CoreErrorCodes.QUERY_CAPACITY_EXCEEDED,
  CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED,
  CoreErrorCodes.COMPONENT_TYPE_IN_USE,
  CoreErrorCodes.INVALID_PARENT,
  CoreErrorCodes.INVALID_MAX_ENTITIES,
  CoreErrorCodes.BUFFER_LENGTH_MISMATCH,
  CoreErrorCodes.INVALID_SHARED_BUFFER,
  CoreErrorCodes.COMPONENT_WRITE_REJECTED,
  CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
  CoreErrorCodes.ARCHETYPE_LIMIT_REACHED,
  CoreErrorCodes.QUERY_INVALID,
  CoreErrorCodes.STORAGE_INCONSISTENT,
];

/** True when `code` is one of the recoverable core WASM codes. */
export function isCoreWasmErrorCode(code: unknown): code is CoreWasmErrorCode {
  return typeof code === "string" && CORE_WASM_ERROR_CODE_LIST.some((known) => known === code);
}

/**
 * Adds a period unless the text already ends with `.`, `?`, or `!`.
 * @internal Shared by the WASM load wrap. Not re-exported from the package index.
 */
export function toSentence(text: string): string {
  if (text.endsWith(".") || text.endsWith("?") || text.endsWith("!")) return text;
  return `${text}.`;
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
    super(code, toSentence(message), { cause });
    this.name = "GwenWasmError";
    this.code = code;
    this.exportName = exportName;
    this.cause = cause;
  }
}

/**
 * A plugin WASM module declared an ABI version other than the core's.
 *
 * `actual` is null when `gwen_plugin_api_version` is absent, not a function,
 * or does not return a number. The module is not registered. The engine keeps
 * running. This is not emitted on the error bus.
 */
export class GwenWasmAbiError extends GwenError {
  override readonly code: typeof CoreErrorCodes.WASM_MODULE_ABI_MISMATCH;
  readonly module: string;
  readonly expected: number;
  readonly actual: number | null;

  constructor(
    moduleName: string,
    expected: number,
    actual: number | null,
    composable = "engine.loadWasmModule",
  ) {
    const shown = actual === null ? "none declared" : String(actual);
    super(
      CoreErrorCodes.WASM_MODULE_ABI_MISMATCH,
      `Plugin "${moduleName}" declares ABI version ${shown}, expected ${expected}.`,
      {
        composable,
        hint: __GWEN_DEV__
          ? "recompile the plugin against the current gwen-wasm-utils / ABI version."
          : undefined,
      },
    );
    this.name = "GwenWasmAbiError";
    this.code = CoreErrorCodes.WASM_MODULE_ABI_MISMATCH;
    this.module = moduleName;
    this.expected = expected;
    this.actual = actual;
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
    super(CoreErrorCodes.WASM_PANIC, toSentence(cause.message), { cause });
    this.name = "GwenWasmPanicError";
    this.code = CoreErrorCodes.WASM_PANIC;
    this.exportName = exportName;
    this.cause = cause;
  }
}

/**
 * Rejected lifecycle call. `code` is `CORE:INVALID_STATE_TRANSITION`.
 * `from` is the state at the call. The message names that state.
 */
export class GwenEngineStateError extends GwenError {
  override readonly code: typeof CoreErrorCodes.INVALID_STATE_TRANSITION;
  readonly from: GwenEngineState;
  readonly method: GwenEngineStateMethod;

  constructor(from: GwenEngineState, method: GwenEngineStateMethod) {
    super(CoreErrorCodes.INVALID_STATE_TRANSITION, `Not allowed while the engine is ${from}.`, {
      composable: `engine.${method}`,
    });
    this.name = "GwenEngineStateError";
    this.code = CoreErrorCodes.INVALID_STATE_TRANSITION;
    this.from = from;
    this.method = method;
  }
}

/** Error codes emitted by the GWEN actor system. */
export const ActorErrorCodes = {
  PLUGIN_NOT_READY: "CORE:ACTOR_PLUGIN_NOT_READY",
  /** A PublicAPI method was called via the `useActor` handle but no live instance exists. */
  NO_LIVE_INSTANCE: "CORE:ACTOR_NO_LIVE_INSTANCE",
  /** Circular actor ownership detected via `useChildren()`. */
  CIRCULAR_OWNERSHIP: "CORE:ACTOR_CIRCULAR_OWNERSHIP",
} as const;

/**
 * Thrown when an actor operation fails.
 * Renders the GWEN grammar; `options` adds composable, hint and cause.
 *
 * @example
 * ```ts
 * if (err instanceof GwenActorError && err.code === 'CORE:ACTOR_PLUGIN_NOT_READY') {
 *   // actor plugin was not installed before spawning
 * }
 * ```
 */
export class GwenActorError extends GwenError {
  constructor(code: string, what: string, options?: GwenErrorOptions) {
    super(code, what, options);
    this.name = "GwenActorError";
  }
}
