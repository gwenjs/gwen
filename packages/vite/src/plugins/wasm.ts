import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import type { GwenViteOptions } from '../types.js';

const WASM_VIRTUAL_ID = 'virtual:gwen/wasm';
const RESOLVED_WASM_VIRTUAL_ID = '\0' + WASM_VIRTUAL_ID;

/**
 * Injects the correct WASM binary as a virtual module.
 *
 * The virtual module `virtual:gwen/wasm` exports:
 * ```ts
 * export const wasmUrl: string  // URL to the WASM binary (asset or inline)
 * ```
 *
 * In dev mode the binary is served at `/@gwen-wasm/<variant>.wasm`.
 * In build mode it is inlined as a base64 data URL.
 *
 * @example
 * ```ts
 * import { wasmUrl } from 'virtual:gwen/wasm'
 * const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl))
 * ```
 */
export function gwenWasmPlugin(options: GwenViteOptions): Plugin {
  let isBuild = false;
  let variant: 'debug' | 'release' = 'debug';

  /** Cached base64-encoded WASM binary for build mode. Null means uncached. */
  let buildCache: string | null = null;

  return {
    name: 'gwen:wasm',
    enforce: 'pre',

    configResolved(config) {
      isBuild = config.command === 'build';
      const requested = options.wasm?.variant ?? 'auto';
      variant = requested === 'auto' ? (isBuild ? 'release' : 'debug') : requested;
      // Invalidate cache on every new build configuration to avoid stale data
      buildCache = null;
    },

    resolveId(id) {
      if (id === WASM_VIRTUAL_ID) return RESOLVED_WASM_VIRTUAL_ID;
    },

    load(id) {
      if (id !== RESOLVED_WASM_VIRTUAL_ID) return;

      const wasmPath = resolveWasmPath(variant, options.wasm?.wasmPath);

      if (!existsSync(wasmPath)) {
        throw new Error(
          `[gwen:wasm] WASM binary not found at ${wasmPath}.\n` +
            `Run 'cargo build --target wasm32-unknown-unknown' first.`,
        );
      }

      // In build mode, inline the binary as a base64 data URL.
      // Cache the result to avoid repeated readFileSync calls across multiple chunks.
      if (isBuild) {
        if (buildCache === null) {
          buildCache = readFileSync(wasmPath).toString('base64');
        }
        return `export const wasmUrl = 'data:application/wasm;base64,${buildCache}'`;
      }

      // In dev mode, serve as a static asset for faster iteration
      return `export const wasmUrl = '/@gwen-wasm/${variant}.wasm'`;
    },

    configureServer(server) {
      // Serve WASM as a static file in dev
      server.middlewares.use('/@gwen-wasm', (req, res) => {
        const requested = (req.url ?? '').replace('/', '');
        const wasmVariant = requested.startsWith('release') ? 'release' : 'debug';
        const wasmPath = resolveWasmPath(wasmVariant, options.wasm?.wasmPath);

        if (!existsSync(wasmPath)) {
          res.statusCode = 404;
          res.end(`WASM not found: ${wasmPath}`);
          return;
        }

        res.setHeader('Content-Type', 'application/wasm');
        res.end(readFileSync(wasmPath));
      });

      // HMR: reload on WASM source change
      if (options.wasm?.hmr !== false) {
        server.watcher.on('change', (file) => {
          if (file.endsWith('.wasm')) {
            server.ws.send({ type: 'full-reload' });
          }
        });
      }
    },
  };
}

/**
 * Resolves the path to the WASM binary for the given variant.
 *
 * When `override` is provided it is resolved relative to `process.cwd()`.
 * Otherwise the binary is resolved from `@gwenjs/core`'s installed location.
 *
 * @param variant - `'debug'` or `'release'`
 * @param override - Optional absolute or relative path override.
 */
function resolveWasmPath(variant: 'debug' | 'release', override?: string): string {
  if (override) return resolve(override);

  const require = createRequire(import.meta.url);
  const corePkg = require.resolve('@gwenjs/core/package.json');
  const coreDir = resolve(corePkg, '..');
  return resolve(coreDir, 'wasm', `gwen_core_${variant}.wasm`);
}
