import { createRequire } from 'node:module';
import type { Plugin } from 'vite';
import type { GwenViteOptions } from '../types.js';

const ENV_VIRTUAL = 'virtual:gwen/env';
const RESOLVED_ENV = '\0' + ENV_VIRTUAL;

/**
 * Provides runtime constants injected at build time via `virtual:gwen/env`.
 *
 * @example Usage in game code
 * ```ts
 * import { GWEN_VERSION, GWEN_WASM_VARIANT, GWEN_DEV } from 'virtual:gwen/env'
 *
 * console.log(GWEN_VERSION)      // '1.0.0'
 * console.log(GWEN_WASM_VARIANT) // 'release'
 * console.log(GWEN_DEV)          // false
 * ```
 */
export function gwenVirtualPlugin(options: GwenViteOptions): Plugin {
  let isBuild = false;
  let variant: 'debug' | 'release' = 'debug';

  return {
    name: 'gwen:virtual',

    configResolved(config) {
      isBuild = config.command === 'build';
      const requested = options.wasm?.variant ?? 'auto';
      variant = requested === 'auto' ? (isBuild ? 'release' : 'debug') : requested;
    },

    resolveId(id) {
      if (id === ENV_VIRTUAL) return RESOLVED_ENV;
    },

    load(id) {
      if (id !== RESOLVED_ENV) return;

      // Read version from @gwenjs/core package.json
      let version = '0.0.0';
      try {
        const require = createRequire(import.meta.url);
        const pkg = require('@gwenjs/core/package.json') as { version: string };
        version = pkg.version;
      } catch {
        // Fall back to '0.0.0' if the package is not resolvable
      }

      return [
        `export const GWEN_VERSION = '${version}'`,
        `export const GWEN_WASM_VARIANT = '${variant}'`,
        `export const GWEN_DEV = ${!isBuild}`,
      ].join('\n');
    },
  };
}
