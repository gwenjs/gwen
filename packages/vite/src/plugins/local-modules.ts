import { resolve, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { GwenViteOptions, LocalModulesOptions } from "../types.js";
import { inferModuleName, scanLocalModuleFiles } from "@gwenjs/app/resolve";
import { createVirtualModule } from "../shared/virtual-module.js";

export { inferModuleName, scanLocalModuleFiles };

/** Directory scanned at `load` time. `false` disables discovery. */
export interface LocalModulesDirOption {
  dir?: string | false;
  /** Project root. Read at `load` time so it can be set after construction. */
  root?: string;
}

const { virtual: LOCAL_MODULES_VIRTUAL, resolved: RESOLVED_LOCAL_MODULES } = createVirtualModule(
  "virtual:gwen/local-modules",
);

/**
 * Generates the `virtual:gwen/local-modules` module source.
 *
 * Each module file is imported and re-exported with an inferred name injected
 * into `meta`. The spread pattern `{ name: '<inferred>', ..._mN.meta }` ensures
 * that an explicit `meta.name` in the module definition always wins over the
 * inferred one.
 *
 * @param files - Absolute paths to local module source files.
 * @param dir   - Absolute path to the modules directory (used for name inference).
 * @returns ESM module source string.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * generateLocalModulesModule(['/project/src/modules/score.ts'], '/project/src/modules')
 * // => "import _m0 from '/project/src/modules/score.ts'\nexport const modules = [\n  { ..._m0, meta: { name: 'local:score', ..._m0.meta } },\n];\n"
 * ```
 */
export function generateLocalModulesModule(files: string[], dir: string): string {
  if (files.length === 0) return "export const modules = [];\n";
  const imports = files.map((f, i) => `import _m${i} from '${f}'`).join("\n");
  const entries = files
    .map((f, i) => `  { ..._m${i}, meta: { name: '${inferModuleName(f, dir)}', ..._m${i}.meta } }`)
    .join(",\n");
  return `${imports}\nexport const modules = [\n${entries},\n];\n`;
}

/**
 * GWEN sub-plugin for local module auto-discovery.
 *
 * Provides `virtual:gwen/local-modules` with imports for all module files
 * found in `src/modules/` (flat `.ts` files and `<name>/index.ts` one level deep).
 * Injects an inferred `meta.name` (`local:<slug>`) for each module so modules
 * do not need to declare their own name.
 * Invalidates the virtual module and triggers a full reload when a file is
 * added, removed, or renamed inside the modules directory.
 *
 * Disabled (no-op) if `options.localModules` is `false`.
 *
 * @param options - Top-level GWEN Vite plugin options.
 * @returns Vite plugin instance.
 */
export function gwenLocalModulesPlugin(options: GwenViteOptions & LocalModulesDirOption): Plugin {
  if (options.localModules === false) {
    return { name: "gwen:local-modules" };
  }

  const opts = options.localModules as LocalModulesOptions | undefined;
  const hmrEnabled = opts?.hmr !== false;
  let root = process.cwd();

  function scannerRoot(): string {
    return options.root ?? root;
  }

  function selectedDir(): string | false {
    if (options.dir !== undefined) return options.dir;
    return opts?.dir ?? "src/modules";
  }

  return {
    name: "gwen:local-modules",

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id === LOCAL_MODULES_VIRTUAL) return RESOLVED_LOCAL_MODULES;
    },

    load(id) {
      if (id !== RESOLVED_LOCAL_MODULES) return;
      const dir = selectedDir();
      if (dir === false) return "export const modules = [];\n";
      const absDir = resolve(scannerRoot(), dir);
      return generateLocalModulesModule(scanLocalModuleFiles(absDir), absDir);
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      if (!hmrEnabled) return;
      const dir = selectedDir();
      if (dir === false) return;
      if (!file.startsWith(resolve(scannerRoot(), dir) + sep)) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_LOCAL_MODULES);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.hot.send({ type: "full-reload" });
      }
    },
  };
}
