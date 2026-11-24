import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { GwenViteOptions } from "../types.js";
import { createVirtualModule } from "../shared/virtual-module.js";
import { findComponentFiles } from "../shared/find-component-files.js";

const { virtual: ACTORS_VIRTUAL, resolved: RESOLVED_ACTORS } =
  createVirtualModule("virtual:gwen/actors");

/**
 * Generates the `virtual:gwen/actors` module source.
 * Each actor file becomes a lazy `() => import(path)` entry.
 *
 * @param actorFiles - Absolute paths to actor source files.
 * @returns ESM module source string.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * generateActorsModule(['/project/src/actors/enemy.ts']);
 * // => "export const actors = [\n  () => import('/project/src/actors/enemy.ts'),\n];\n"
 * ```
 */
export function generateActorsModule(actorFiles: string[]): string {
  if (actorFiles.length === 0) {
    return "export const actors = [];\n";
  }
  const entries = actorFiles.map((f) => `  () => import('${f}')`).join(",\n");
  return `export const actors = [\n${entries},\n];\n`;
}

/**
 * GWEN sub-plugin for actor auto-discovery, the virtual module, and HMR.
 *
 * - Provides `virtual:gwen/actors` with lazy imports for all files in `src/actors/`
 * - Invalidates the virtual module on file changes in the actors directory
 *
 * Disabled (no-op) if `options.actors` is not set.
 *
 * @param options - Top-level GWEN Vite plugin options.
 * @returns Vite plugin instance.
 *
 * @example vite.config.ts
 * ```ts
 * import { defineConfig } from 'vite';
 * import { gwenVitePlugin } from '@gwenjs/vite';
 *
 * export default defineConfig({
 *   plugins: [gwenVitePlugin({ actors: { dir: 'src/actors', hmr: true } })],
 * });
 * ```
 */
export function gwenActorPlugin(options: GwenViteOptions): Plugin {
  if (!options.actors) {
    return { name: "gwen:actor" };
  }

  const actorDir = options.actors.dir ?? "src/actors";
  const hmrEnabled = options.actors.hmr !== false;
  let root = process.cwd();

  return {
    name: "gwen:actor",

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id === ACTORS_VIRTUAL) return RESOLVED_ACTORS;
    },

    load(id) {
      if (id !== RESOLVED_ACTORS) return;
      return generateActorsModule(findComponentFiles(resolve(root, actorDir)));
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      if (!hmrEnabled) return;
      if (!file.startsWith(resolve(root, actorDir))) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_ACTORS);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.hot.send({ type: "full-reload" });
      }
    },
  };
}
