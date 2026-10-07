/**
 * @file @gwenjs/app — browser-safe types and defineConfig helper.
 *
 * This file has NO Node.js dependencies. It is safe to import in browser
 * contexts (e.g. gwen.config.ts bundled by Vite).
 */

import type { GwenPlugin } from "@gwenjs/core";
import type { GwenBuildHooks } from "@gwenjs/kit/module";
import type { ViewportRegion } from "@gwenjs/renderer-core";
import type { IGwenLogProvider, GwenLogLevel } from "@gwenjs/schema";

export type { GwenBuildHooks } from "@gwenjs/kit/module";
import type { ScreenSizeProvider } from "@gwenjs/renderer-core";

// ─── Logger and Debug Config ────────────────────────────────────────────────

/**
 * Logger configuration block in `gwen.config.ts`.
 *
 * @example
 * ```typescript
 * logger: {
 *   providers: [consoleLogProvider(), myCustomProvider()],
 *   minLevel: 'info'
 * }
 * ```
 */
export interface GwenLoggerConfig {
  /**
   * One or more providers that receive every log entry.
   * @default [consoleLogProvider()]
   */
  providers?: IGwenLogProvider[];
  /**
   * Entries below this level are silently dropped before reaching providers.
   * @default 'warn'
   */
  minLevel?: GwenLogLevel;
}

/**
 * Debug / profiling options in `gwen.config.ts`.
 */
export interface GwenDebugConfig {
  /**
   * When `true`, the engine emits `engine:perf:tick`, `engine:perf:system`, and
   * `engine:perf:plugin` hooks with timing data.
   * @default false
   */
  perf?: boolean;
}

// ─── GwenModuleOptions (augmentable) ─────────────────────────────────────────

/**
 * Augmented by each module package to add typed options.
 *
 * @example Adding physics2d options
 * ```typescript
 * // In @gwenjs/physics2d:
 * declare module '@gwenjs/app' {
 *   interface GwenModuleOptions {
 *     physics2d: { gravity: number }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface GwenModuleOptions {}

/**
 * A module entry in `gwen.config.ts` — the npm package name of the module.
 *
 * Module-specific options are declared as a top-level key in `gwen.config.ts`,
 * using the `configKey` declared in the module's `meta`.
 *
 * @example
 * ```typescript
 * modules: ['@gwenjs/physics2d'],
 * physics2d: { gravity: { x: 0, y: -9.81, z: 0 } }
 * ```
 */
export type GwenModuleEntry = string;

/**
 * The full GWEN framework configuration shape.
 *
 * Module-specific options are typed via {@link GwenModuleOptions} declaration merging.
 *
 * @example
 * ```typescript
 * // gwen.config.ts
 * import { defineConfig } from '@gwenjs/app'
 * export default defineConfig({
 *   modules: ['@gwenjs/physics2d'],
 *   engine: { maxEntities: 5_000 },
 * })
 * ```
 */
export interface GwenUserConfig extends GwenModuleOptions {
  /**
   * List of modules to activate. Each entry is the npm package name.
   * Module options are declared as a top-level key — see {@link GwenModuleOptions}.
   */
  modules?: GwenModuleEntry[];

  /** Core engine configuration */
  engine?: {
    maxEntities?: number;
    targetFPS?: number;
    variant?: "light" | "physics2d" | "physics3d";
    loop?: "internal" | "external" | "fixed";
    physicsHz?: number; // fréquence fixe, ex: 60
    maxCatchupSteps?: number; // défaut 2
    maxDeltaSeconds?: number;
    /**
     * Enable global debug mode. Logger `debug` and `info` follow this flag.
     * Per-frame sentinel checks, phase timing, and the isolation warning run only
     * in a development build (`__GWEN_DEV__`) when this is also `true`.
     * @default false
     */
    debug?: boolean;
  };

  /** Logger configuration. */
  logger?: GwenLoggerConfig;

  /** Debug / profiling configuration. */
  debug?: GwenDebugConfig;

  /**
   * Global CSS files to inject into every page.
   * Paths are relative to the project root (e.g. `'./src/styles/global.css'`).
   *
   * @example
   * ```ts
   * globalCss: ['./src/styles/reset.css', './src/styles/global.css']
   * ```
   */
  globalCss?: string[];

  /** Direct Vite config extension (simple case). */
  vite?: Record<string, unknown>;

  /** Build-time hook subscriptions. */
  hooks?: Partial<GwenBuildHooks>;

  /** Plugins to register directly (without a module). */
  plugins?: GwenPlugin[];

  /**
   * Override the directory scanned for local plugins.
   * Set to `false` to disable auto-discovery.
   * @default 'src/plugins'
   */
  localPluginsDir?: string | false;

  /**
   * Override the directory scanned for local modules.
   * Set to `false` to disable auto-discovery.
   * @default 'src/modules'
   */
  localModulesDir?: string | false;

  /**
   * Static viewport declarations — normalized [0–1] screen regions.
   *
   * `@gwenjs/app` passes these to `ViewportManager` at engine startup.
   * If absent, a default fullscreen `'main'` viewport is created automatically.
   *
   * @example
   * ```ts
   * // Split-screen
   * viewports: {
   *   p1: { x: 0,   y: 0, width: 0.5, height: 1 },
   *   p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
   * }
   * ```
   */
  viewports?: Record<string, ViewportRegion>;

  /**
   * Screen size configuration. By default, `ScreenPlugin` auto-detects the environment:
   * - Browser with `ResizeObserver`: uses `BrowserSizeProvider()` on `document.documentElement`.
   * - No DOM: logs a warning and uses size `{ width: 0, height: 0 }`.
   *
   * Provide a `sizeProvider` to override this behaviour for Node.js servers,
   * Electron apps, or embedded games with a specific container element.
   *
   * @example Node.js game server
   * ```ts
   * import { StaticSizeProvider } from '@gwenjs/renderer-core'
   * screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) }
   * ```
   */
  screen?: {
    sizeProvider?: ScreenSizeProvider;
  };
}

/** Fully resolved config (same shape as user config, with defaults filled in). */
export type ResolvedGwenConfig = GwenUserConfig & {
  engine: Required<NonNullable<GwenUserConfig["engine"]>>;
  modules: string[];
  logger: GwenLoggerConfig & { minLevel: GwenLogLevel };
  debug: GwenDebugConfig & { perf: boolean };
};

/**
 * Identity helper for `gwen.config.ts`. Provides TypeScript inference for module options.
 * This is a pure function with no Node.js dependencies — safe to import in the browser.
 *
 * @example
 * ```typescript
 * import { defineConfig } from '@gwenjs/app'
 * export default defineConfig({
 *   modules: ['@gwenjs/physics2d'],
 *   physics2d: { gravity: { x: 0, y: -9.81, z: 0 } },
 *   engine: { maxEntities: 5_000 },
 * })
 * ```
 */
export function defineConfig(config: GwenUserConfig): GwenUserConfig {
  return config;
}
