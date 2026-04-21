import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { GwenViteOptions, LocalPluginsOptions } from "../types.js";
import { createVirtualModule } from "../shared/virtual-module.js";

const { virtual: LOCAL_PLUGINS_VIRTUAL, resolved: RESOLVED_LOCAL_PLUGINS } = createVirtualModule(
  "virtual:gwen/local-plugins",
);

/**
 * Flat-scans `dir` for `.ts` and `.tsx` plugin source files.
 * Excludes test files (`*.test.ts`, `*.test.tsx`) and type declarations (`*.d.ts`).
 * Does NOT recurse — only direct children of `dir` are returned.
 * Returns files in alphabetical order.
 *
 * @param dir - Absolute path to the plugins directory.
 * @returns Sorted array of absolute file paths.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * scanLocalPluginFiles('/project/src/plugins')
 * // => ['/project/src/plugins/audio.ts', '/project/src/plugins/input.ts']
 * ```
 */
export function scanLocalPluginFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) continue;
    if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".d.ts")
    ) {
      result.push(full);
    }
  }
  return result;
}

/**
 * Generates the `virtual:gwen/local-plugins` module source.
 * Each plugin file becomes a named import; `plugins` is exported as an array
 * of factory references — the framework calls each factory with no arguments
 * to obtain a plugin instance.
 *
 * @param files - Absolute paths to local plugin source files.
 * @returns ESM module source string.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * generateLocalPluginsModule(['/project/src/plugins/audio.ts']);
 * // => "import _p0 from '/project/src/plugins/audio.ts'\nexport const plugins = [_p0];\n"
 * ```
 */
export function generateLocalPluginsModule(files: string[]): string {
  if (files.length === 0) return "export const plugins = [];\n";
  const imports = files.map((f, i) => `import _p${i} from '${f}'`).join("\n");
  const entries = files.map((_, i) => `_p${i}`).join(", ");
  return `${imports}\nexport const plugins = [${entries}];\n`;
}

/**
 * GWEN sub-plugin for local plugin auto-discovery.
 *
 * Provides `virtual:gwen/local-plugins` with eager imports for all `.ts` files
 * found directly inside `src/plugins/` (flat scan — no subdirectories).
 * Invalidates the virtual module and triggers a full reload when a file is
 * added, removed, or renamed inside the plugins directory.
 *
 * Disabled (no-op) if `options.localPlugins` is `false`.
 *
 * @param options - Top-level GWEN Vite plugin options.
 * @returns Vite plugin instance.
 */
export function gwenLocalPluginsPlugin(options: GwenViteOptions): Plugin {
  if (options.localPlugins === false) {
    return { name: "gwen:local-plugins" };
  }

  const opts = options.localPlugins as LocalPluginsOptions | undefined;
  const pluginsDir = opts?.dir ?? "src/plugins";
  const hmrEnabled = opts?.hmr !== false;
  let root = process.cwd();

  return {
    name: "gwen:local-plugins",

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id === LOCAL_PLUGINS_VIRTUAL) return RESOLVED_LOCAL_PLUGINS;
    },

    load(id) {
      if (id !== RESOLVED_LOCAL_PLUGINS) return;
      return generateLocalPluginsModule(scanLocalPluginFiles(resolve(root, pluginsDir)));
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      if (!hmrEnabled) return;
      if (!file.startsWith(resolve(root, pluginsDir) + "/")) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_LOCAL_PLUGINS);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.hot.send({ type: "full-reload" });
      }
    },
  };
}
