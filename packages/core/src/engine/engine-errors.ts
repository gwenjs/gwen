/**
 * @file Engine error types and error codes.
 *
 * Extracted from gwen-engine.ts — pure type/class definitions with no runtime
 * engine dependencies. Safe to import without pulling in the full engine module.
 */

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

// ─── Error class ────────────────────────────────────────────────────────────

/**
 * Thrown when a required plugin/service has not been registered with the engine.
 *
 * Provides an actionable error message with a hint for fixing the problem
 * and a link to the plugin documentation.
 *
 * throw new GwenPluginNotFoundError({
 *   pluginName: 'physics2d',
 *   hint: 'Call engine.use(physics2dPlugin()) before accessing this service.',
 *   docsUrl: 'https://gwenengine.dev/docs/plugins'
 * })
 * throw new GwenPluginNotFoundError({
 *   pluginName: '@gwenjs/physics2d',
 *   hint: 'Add @gwenjs/physics2d to the modules array in gwen.config.ts',
 *   docsUrl: 'https://gwenengine.dev/modules/physics2d',
 * })
 * ```
 */
export class GwenPluginNotFoundError extends Error {
  readonly pluginName: string;
  /** Human-readable hint explaining how to fix the issue. */
  readonly hint: string;
  /** URL to relevant documentation. */
  readonly docsUrl: string;

  constructor(opts: GwenPluginNotFoundErrorOptions) {
    const hint =
      opts.hint || `Add the "${opts.pluginName}" plugin via engine.use() or in gwen.config.ts.`;
    const docsUrl = opts.docsUrl || "https://gwenengine.dev/docs/plugins";
    super(`[GwenEngine] Plugin/service "${opts.pluginName}" not found. ${hint}`);
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
} as const;
