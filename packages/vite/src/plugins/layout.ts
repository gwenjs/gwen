import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import MagicString from 'magic-string';
import { walk } from 'oxc-walker';
import type { VariableDeclarator } from 'oxc-parser';
import type { GwenViteOptions } from '../types.js';
import { parseSource, isCallTo } from '../oxc/index.js';

const LAYOUTS_VIRTUAL = 'virtual:gwen/layouts';
const RESOLVED_LAYOUTS = '\0' + LAYOUTS_VIRTUAL;

/**
 * Options for the `gwen:layout` sub-plugin.
 */
export interface GwenLayoutOptions {
  /**
   * Glob patterns for layout source files.
   * @default ['src/layouts/**\/*.ts', 'src/**\/*.layout.ts']
   */
  include?: string[];

  /**
   * Disable debug name injection (default: false).
   * When `false`, `defineLayout(...)` calls are wrapped with `Object.assign(..., { __layoutName__: 'Name' })`.
   * @default false
   */
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
    return 'export const layouts = {};\n';
  }

  const entries = Array.from(layoutMap.entries())
    .map(([name, path]) => `  '${name}': () => import('${path}')`)
    .join(',\n');

  return `export const layouts = {\n${entries},\n};\n`;
}

/**
 * Inject `__layoutName__` metadata into each `defineLayout(...)` call by
 * wrapping it with `Object.assign(defineLayout(...), { __layoutName__: 'VarName' })`.
 *
 * Uses AST-based parsing so deeply nested callbacks inside `defineLayout` are
 * handled correctly — the regex approach broke with `spawn(prefab(x))` patterns.
 *
 * @param code     - TypeScript source code to transform.
 * @param filename - File path for the parser.
 * @returns Transformed source, or the original if no changes were made.
 */
export function transformLayoutNames(code: string, filename = 'layout.ts'): string {
  if (!code.includes('defineLayout')) return code;

  const parsed = parseSource(filename, code);
  if (!parsed) return code;

  const s = new MagicString(code);
  let changed = false;

  walk(parsed.program, {
    enter(node) {
      if (node.type !== 'VariableDeclarator') return;
      const { id, init } = node as VariableDeclarator;
      if (id.type !== 'Identifier') return;
      if (!init || !isCallTo(init, 'defineLayout')) return;

      const varName = (id as { name: string }).name;
      s.prependLeft(init.start, 'Object.assign(');
      s.appendRight(init.end, `, { __layoutName__: '${varName}' })`);
      changed = true;
    },
  });

  return changed ? s.toString() : code;
}

/**
 * Extract all variable names bound to `defineLayout(...)` calls in the given source.
 * Uses AST parsing to avoid false positives in comments or strings.
 *
 * @param code     - TypeScript source code to scan.
 * @param filename - File path for the parser.
 * @returns Set of variable names found in `defineLayout` declarations.
 */
export function extractLayoutNames(code: string, filename = 'layout.ts'): Set<string> {
  const names = new Set<string>();
  if (!code.includes('defineLayout')) return names;

  const parsed = parseSource(filename, code);
  if (!parsed) return names;

  walk(parsed.program, {
    enter(node) {
      if (node.type !== 'VariableDeclarator') return;
      const { id, init } = node as VariableDeclarator;
      if (id.type !== 'Identifier') return;
      if (!init || !isCallTo(init, 'defineLayout')) return;
      names.add((id as { name: string }).name);
    },
  });

  return names;
}

/**
 * Recursively scans directories for layout source files (`.ts`, excluding
 * `.test.ts` and `.d.ts`).
 *
 * @param dir - Absolute path to the directory to scan.
 * @returns Array of absolute file paths.
 */
function scanLayoutDir(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const result: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      result.push(...scanLayoutDir(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      result.push(full);
    }
  }

  return result;
}

/**
 * GWEN sub-plugin for layout virtual module generation and debug name injection.
 *
 * **Phase 1 (current):**
 * - Provides `virtual:gwen/layouts` with a registry of layouts found in layout files
 * - Injects `__layoutName__` debug names via `Object.assign()` wrapping
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
    return { name: 'gwen:layout' };
  }

  const include = options.layout.include ?? ['src/layouts/**/*.ts', 'src/**/*.layout.ts'];
  const disableNameInjection = options.layout.disableNameInjection ?? false;
  let root = process.cwd();

  // Build a set of layout directories from include patterns
  const layoutDirs = new Set<string>();
  for (const pattern of include) {
    // Extract the base directory from the pattern (before any wildcards)
    const basePath = pattern.split('**')[0].replace(/\/$/, '');
    if (basePath) {
      layoutDirs.add(resolve(root, basePath));
    }
  }

  return {
    name: 'gwen:layout',

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id === LAYOUTS_VIRTUAL) return RESOLVED_LAYOUTS;
    },

    load(id) {
      if (id !== RESOLVED_LAYOUTS) return;

      const layoutMap = new Map<string, string>();

      // Scan layout directories for files
      for (const dir of layoutDirs) {
        const files = scanLayoutDir(dir);

        for (const file of files) {
          // Read the file to extract layout names
          try {
            const code = readFileSync(file, 'utf-8');
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
          server.hot.send({ type: 'full-reload' });
        }
        break;
      }
    },

    transform(code, id) {
      if (disableNameInjection) return;

      // Check if the file is in one of our layout directories
      let inLayoutDir = false;
      for (const dir of layoutDirs) {
        if (id.startsWith(dir)) {
          inLayoutDir = true;
          break;
        }
      }

      if (!inLayoutDir) return;

      const transformed = transformLayoutNames(code);
      if (transformed === code) return;

      return { code: transformed, map: null };
    },
  };
}
