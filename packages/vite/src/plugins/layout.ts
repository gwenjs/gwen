import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { walk } from "oxc-walker";
import type { GwenViteOptions } from "../types.js";
import { parseSource, isCallTo } from "../oxc/index.js";
import { createVirtualModule } from "../shared/virtual-module.js";
import { findComponentFiles } from "../shared/find-component-files.js";

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
 * Extract all variable names bound to `defineLayout(...)` calls in the given source.
 * Uses AST parsing to avoid false positives in comments or strings.
 *
 * @param code     - TypeScript source code to scan.
 * @param filename - File path for the parser.
 * @returns Set of variable names found in `defineLayout` declarations.
 */
export function extractLayoutNames(code: string, filename = "layout.ts"): Set<string> {
  const names = new Set<string>();
  if (!code.includes("defineLayout")) return names;

  const parsed = parseSource(filename, code);
  if (!parsed) return names;

  walk(parsed.program, {
    enter(node) {
      if (node.type !== "VariableDeclarator") return;
      const { id, init } = node;
      if (id.type !== "Identifier") return;
      if (!init || !isCallTo(init, "defineLayout")) return;
      names.add(id.name);
    },
  });

  return names;
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
      const head = pattern.split("**")[0];
      const basePath = head === undefined ? "" : head.replace(/\/$/, "");
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

      // Scan layout directories for files
      for (const dir of layoutDirs) {
        const files = findComponentFiles(dir);

        for (const file of files) {
          // Read the file to extract layout names
          try {
            const code = readFileSync(file, "utf-8");
            const names = extractLayoutNames(code, file);
            for (const name of names) layoutMap.set(name, file);
          } catch {
            // Silently skip files that cannot be read
          }
        }
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
