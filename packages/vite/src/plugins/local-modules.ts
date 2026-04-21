import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, join, relative, basename, sep } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { GwenViteOptions, LocalModulesOptions } from "../types.js";
import { createVirtualModule } from "../shared/virtual-module.js";

const { virtual: LOCAL_MODULES_VIRTUAL, resolved: RESOLVED_LOCAL_MODULES } = createVirtualModule(
  "virtual:gwen/local-modules",
);

/**
 * Infers the module name from its absolute file path and the absolute base directory.
 *
 * Rules:
 * - `<dir>/score.ts`         → `local:score`
 * - `<dir>/score/index.ts`   → `local:score`
 * - The `local:` prefix marks it as a user-local module (avoids npm namespace collisions).
 *
 * @param filePath - Absolute path to the module file.
 * @param dir      - Absolute path to the modules directory.
 * @returns Inferred module name in `local:<slug>` format.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * inferModuleName('/project/src/modules/score.ts', '/project/src/modules')
 * // => 'local:score'
 * inferModuleName('/project/src/modules/score/index.ts', '/project/src/modules')
 * // => 'local:score'
 * ```
 */
export function inferModuleName(filePath: string, dir: string): string {
  const rel = relative(dir, filePath);
  const parts = rel.split(sep);
  if (parts.length === 2 && (parts[1] === "index.ts" || parts[1] === "index.tsx")) {
    return `local:${parts[0]}`;
  }
  const file = basename(rel);
  const slug = file.replace(/\.tsx?$/, "");
  return `local:${slug}`;
}

/**
 * Scans `dir` for local module source files. Returns flat `.ts`/`.tsx` files
 * and `<name>/index.ts` / `<name>/index.tsx` files one level deep.
 * Excludes test files and type declarations.
 * Returns entries sorted alphabetically by inferred module name.
 *
 * @param dir - Absolute path to the modules directory.
 * @returns Sorted array of absolute file paths.
 *
 * @internal Exported for unit tests.
 *
 * @example
 * ```ts
 * scanLocalModuleFiles('/project/src/modules')
 * // => ['/project/src/modules/audio/index.ts', '/project/src/modules/score.ts']
 * ```
 */
export function scanLocalModuleFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      for (const indexName of ["index.ts", "index.tsx"]) {
        const indexPath = join(full, indexName);
        if (existsSync(indexPath)) {
          result.push(indexPath);
          break;
        }
      }
      continue;
    }

    if (
      (entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx") &&
      !entry.endsWith(".d.ts")
    ) {
      result.push(full);
    }
  }

  return result.sort((a, b) => {
    const slugA = inferModuleName(a, dir).replace("local:", "");
    const slugB = inferModuleName(b, dir).replace("local:", "");
    return slugA.localeCompare(slugB);
  });
}

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
export function gwenLocalModulesPlugin(options: GwenViteOptions): Plugin {
  if (options.localModules === false) {
    return { name: "gwen:local-modules" };
  }

  const opts = options.localModules as LocalModulesOptions | undefined;
  const modulesDir = opts?.dir ?? "src/modules";
  const hmrEnabled = opts?.hmr !== false;
  let root = process.cwd();

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
      const absDir = resolve(root, modulesDir);
      return generateLocalModulesModule(scanLocalModuleFiles(absDir), absDir);
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      if (!hmrEnabled) return;
      if (!file.startsWith(resolve(root, modulesDir) + sep)) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_LOCAL_MODULES);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.hot.send({ type: "full-reload" });
      }
    },
  };
}
