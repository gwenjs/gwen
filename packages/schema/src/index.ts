/**
 * GWEN Configuration Schema - Main Entry Point
 *
 * Single source of truth for GWEN engine configuration types and defaults.
 *
 * @module @gwenjs/schema
 */

// ─── types ──────────────────────────────────────────────────────────────────
export type {
  GwenHookHandler,
  GwenModuleEntry,
  GwenOptions,
  GwenConfigInput,
  DeepPartial,
  EngineAPI,
} from "./config";

export type {
  EngineLifecycleHooks,
  PluginLifecycleHooks,
  EntityLifecycleHooks,
  ComponentLifecycleHooks,
  SceneLifecycleHooks,
  ExtensionLifecycleHooks,
  GwenHooks,
} from "./hooks";

// ─── Runtime ─────────────────────────────────────────────────────────────────
export { defaultOptions, resolveConfig } from "./defaults.js";
export { validateResolvedConfig, assertModuleFirstInput } from "./validate.js";
// ─── Disposable ──────────────────────────────────────────────────────────────

export type { GwenDisposable, DisposableRegistryBase } from "./disposable.js";

// ─── Errors ──────────────────────────────────────────────────────────────────

export { GwenError } from "./errors.js";
export type { GwenErrorLevel, GwenErrorPayload, GwenErrorBusBase } from "./errors.js";

// ─── Logger ──────────────────────────────────────────────────────────────────

export type { LogLevel, LogEntry, GwenLogger } from "./logger.js";

// ─── Plugin ──────────────────────────────────────────────────────────────────

export type { GwenRuntimeHooks, HookBusBase, GwenEngineBase, PluginErrorContext, GwenPlugin } from "./plugin.js";

// ─── Backwards compat ────────────────────────────────────────────────────────

/**
 * @deprecated Use {@link GwenPlugin} from `'@gwenjs/schema'` instead.
 *
 * `GwenPluginBase` was the legacy name for the plugin contract defined in
 * `@gwenjs/schema`. The name was unified with `GwenPlugin` (the name used
 * by `@gwenjs/core`) to eliminate the two-interface confusion.
 *
 * **Migration:** Replace `GwenPluginBase` with `GwenPlugin`.
 * ```ts
 * // Before:
 * import type { GwenPluginBase } from '@gwenjs/schema'
 * // After:
 * import type { GwenPlugin } from '@gwenjs/schema'
 * ```
 *
 * Will be removed in v2.0.
 */
export type { GwenPlugin as GwenPluginBase } from "./plugin.js";
