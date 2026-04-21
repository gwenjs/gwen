/**
 * @file @gwenjs/app/setup — Runtime bootstrap orchestrator.
 *
 * setupGwen() initializes the WASM bridge and creates an engine from a resolved config.
 * This is the canonical entry point for all runtime initialization in GWEN applications.
 *
 * The framework calls this function from the generated entry module bootstrap code.
 * Users can also call it manually when building custom game loops or integrations.
 *
 * @example
 * ```typescript
 * import { setupGwen } from '@gwenjs/app';
 * import gwenConfig from './gwen.config';
 *
 * const engine = await setupGwen(gwenConfig);
 * await engine.start();
 * ```
 */

import {
  createEngine,
  WasmBridgeImpl,
  detectCoreVariant,
  detectSharedMemoryRequired,
  GwenLogger,
  consoleLogProvider,
} from "@gwenjs/core";
import { createViewportsPlugin } from "./viewports-plugin";
import { createScreenPlugin } from "./create-screen-plugin";
import type { ResolvedGwenConfig } from "./types";
import type { GwenEngine } from "@gwenjs/core";

/**
 * Bootstrap the GWEN engine from a resolved config.
 *
 * Handles:
 * - WASM initialization (detects variant, loads binaries)
 * - Engine creation
 * - Built-in plugin registration (viewports, screen)
 * - User plugin registration (if provided)
 *
 * The engine is NOT started — call `engine.start()` after wiring scenes and additional plugins.
 *
 * @param config - Fully resolved GWEN configuration (output of resolveGwenConfig)
 * @returns A fully initialized but not-yet-running GwenEngine
 * @throws {Error} If WASM cannot be loaded or engine initialization fails
 *
 * @example
 * ```typescript
 * const engine = await setupGwen(gwenConfig);
 *
 * // Wire scenes (optional)
 * // await registerScenes(engine);
 *
 * // Start the engine
 * await engine.start();
 * ```
 */
export async function setupGwen(config: ResolvedGwenConfig): Promise<GwenEngine> {
  // Detect WASM variant and SharedArrayBuffer requirement from config
  // The detection functions expect a looser config type — cast aggressively
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variantConfig = config as any;
  const variant = detectCoreVariant(variantConfig);
  const requireSAB = detectSharedMemoryRequired(variantConfig);

  // Initialize WASM and pass the bridge directly to the engine
  const bridge = new WasmBridgeImpl();
  await bridge.init(variant, { requireSAB });

  // Create the engine with user config options
  const engine = await createEngine({
    ...config.engine,
    variant,
    _bridge: bridge,
  });

  // Create and register logger
  const loggerConfig = config.logger ?? {};
  const logger = new GwenLogger(
    loggerConfig.providers ?? [consoleLogProvider()],
    loggerConfig.minLevel ?? "warn",
  );
  // Assign to engine instance (if engine.logger property exists)
  (engine as any).logger = logger;

  // Register built-in plugins (viewports first, then screen which depends on viewports)
  await engine.use(createViewportsPlugin(config.viewports));
  await engine.use(createScreenPlugin(config.screen));

  // Register user plugins from config.plugins
  for (const plugin of config.plugins ?? []) {
    await engine.use(plugin);
  }

  return engine;
}
