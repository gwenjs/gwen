/**
 * @file Shared interop-aware config loader (RFC-011).
 *
 * Node.js-only. Never import from browser-side code.
 *
 * ## Why this exists
 *
 * When the GWEN CLI runs, `bin.js` registers jiti as a Node.js module-loader
 * hook via `register(jitiHooksUrl, …)`.  This lets `import()` resolve `.ts`
 * files, but it introduces a CJS/ESM double-wrapping problem:
 *
 * 1. jiti transpiles `export default defineConfig({…})` to CJS:
 *    `Object.defineProperty(exports, '__esModule', {value:true}); exports.default = cfg`
 * 2. Node.js wraps the CJS `exports` object as ESM:
 *    `{ default: { __esModule: true, default: cfg } }`
 * 3. c12's `_resolveModule` returns `mod.default = { __esModule: true, default: cfg }`
 * 4. The final `config` seen by callers is `{ default: cfg }`, so `config.modules` is
 *    `undefined` and all module setup is silently skipped.
 *
 * The fix: provide a custom `resolveModule` to c12 that handles all three
 * wrapping depths (no wrap, single wrap, double wrap).
 */

import { existsSync } from 'node:fs';
import { loadConfig } from 'c12';
import type { GwenUserConfig } from './types';

// ─── GwenConfigLoadError ─────────────────────────────────────────────────────

/**
 * Thrown when `gwen.config.ts` cannot be loaded.
 * Carries the resolved config file path and the original cause.
 */
export class GwenConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly configFile: string | undefined,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = 'GwenConfigLoadError';
  }
}

// ─── loadRawGwenConfig ───────────────────────────────────────────────────────

export interface RawGwenConfig {
  /** The raw user config from the file, fully unwrapped. */
  config: GwenUserConfig;
  /** Absolute path to the resolved config file. */
  configFile: string;
}

/**
 * Loads `gwen.config.ts` from `cwd` using c12 + jiti, and correctly unwraps
 * the default export regardless of how many CJS/ESM interop layers are present.
 *
 * Used by both {@link resolveGwenConfig} (`@gwenjs/app`) and `loadGwenConfig`
 * (CLI) to ensure consistent config loading across all commands.
 *
 * @param cwd - Project root directory containing `gwen.config.ts`.
 * @throws {GwenConfigLoadError} If no config file is found, or if the file
 *   cannot be parsed/evaluated (syntax error, missing imports, etc.).
 */
export async function loadRawGwenConfig(cwd: string): Promise<RawGwenConfig> {
  let configFile: string | undefined;

  try {
    const result = await loadConfig<GwenUserConfig>({
      name: 'gwen',
      cwd,
      dotenv: true,
      // Custom resolver that handles CJS/ESM double-wrapping from jiti-register hook.
      // Three cases:
      //   1. No wrapping  → mod IS the config object
      //   2. Single wrap  → mod.default IS the config object
      //   3. Double wrap  → mod.default.default IS the config object
      //      (occurs when jiti-register hook intercepts the import and Node.js
      //       then wraps the CJS exports object as an ESM namespace)
      resolveModule: (mod: unknown): GwenUserConfig => {
        const first = (mod as Record<string, unknown>)?.['default'] ?? mod;
        const second = (first as Record<string, unknown>)?.['default'] ?? first;
        return (second ?? {}) as GwenUserConfig;
      },
    });

    configFile = result.configFile ?? undefined;

    if (!configFile || !existsSync(configFile)) {
      throw new GwenConfigLoadError(
        `No gwen.config.ts (or .js / .mjs / .cjs) found in ${cwd}`,
        undefined,
        null,
      );
    }

    return {
      config: (result.config ?? {}) as GwenUserConfig,
      configFile,
    };
  } catch (error) {
    if (error instanceof GwenConfigLoadError) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    throw new GwenConfigLoadError(
      `Failed to load gwen config from ${configFile ?? cwd}: ${msg}. ` +
        `Check for syntax errors or missing imports in your config file.`,
      configFile,
      error,
    );
  }
}
