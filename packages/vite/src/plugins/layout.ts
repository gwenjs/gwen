import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { GwenViteOptions } from "../types.js";
import { createVirtualModule } from "../shared/virtual-module.js";
import { scanLayoutNames } from "../scanners/index.js";
import { includeBase } from "../scanners/read.js";

const { virtual: LAYOUTS_VIRTUAL, resolved: RESOLVED_LAYOUTS } =
  createVirtualModule("virtual:gwen/layouts");

/**
 * Options for the `gwen:layout` sub-plugin.
 */
export interface GwenLayoutOptions {
  /**
   * Glob patterns for layout source files.
   * @default ['src/layouts/**\/*.ts', 'src/**\/*.layout.ts']
   */
  include?: string[];

  disableNameInjection?: boolean;
}

/**
 * Generates the `virtual:gwen/layouts` module source.
 * Each layout file with `defineLayout(...)` becomes a lazy `() => import(path)` entry.
 *
 * @param layoutMap - Map of layout names to absolute file paths.
 * @returns ESM module source string.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * generateLayoutsModule(new Map([['Level1', '/project/src/layouts/level-1.ts']]));
 * // => "export const layouts = {\n  'Level1': () => import('/project/src/layouts/level-1.ts'),\n};\n"
 * ```
 */
export function generateLayoutsModule(layoutMap: Map<string, string>): string {
  if (layoutMap.size === 0) {
    return "export const layouts = {};\n";
  }

  const entries = Array.from(layoutMap.entries())
    .map(([name, path]) => `  '${name}': () => import('${path}')`)
    .join(",\n");

  return `export const layouts = {\n${entries},\n};\n`;
}

/**
 * GWEN sub-plugin for the layout virtual module.
 *
 * **Phase 1 (current):**
 * - Provides `virtual:gwen/layouts` with a registry of layouts found in layout files
 * - Optionally invalidates the virtual module on file changes
 *
 * **Phase 2 (future):**
 * - bulkSpawn transform optimization for efficient batch spawning
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
 *   plugins: [gwenVitePlugin()],
 * });
 * ```
 */
export function gwenLayoutPlugin(options: GwenViteOptions): Plugin {
  if (!options.layout) {
    return { name: "gwen:layout" };
  }

  const include = options.layout.include ?? ["src/layouts/**/*.ts", "src/**/*.layout.ts"];
  let root = process.cwd();

  // Build a set of layout directories from include patterns
  const layoutDirs = new Set<string>();
  const rebuildLayoutDirs = (baseRoot: string): void => {
    layoutDirs.clear();
    for (const pattern of include) {
      // Extract the base directory from the pattern (before any wildcards)
      const basePath = includeBase(pattern);
      if (basePath) layoutDirs.add(resolve(baseRoot, basePath));
    }
  };
  rebuildLayoutDirs(root);

  return {
    name: "gwen:layout",

    configResolved(config) {
      root = config.root;
      rebuildLayoutDirs(root);
    },

    resolveId(id) {
      if (id === LAYOUTS_VIRTUAL) return RESOLVED_LAYOUTS;
    },

    load(id) {
      if (id !== RESOLVED_LAYOUTS) return;

      const layoutMap = new Map<string, string>();
      for (const { name, file } of scanLayoutNames(root, include, {
        autoImports: options.autoImports ?? [],
      })) {
        layoutMap.set(name, file);
      }

      return generateLayoutsModule(layoutMap);
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      // Check if the file is in one of our layout directories
      for (const dir of layoutDirs) {
        if (!file.startsWith(dir)) continue;

        const mod = server.moduleGraph.getModuleById(RESOLVED_LAYOUTS);
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
          server.hot.send({ type: "full-reload" });
        }
        break;
      }
    },
  };
}
