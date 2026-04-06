import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import MagicString from 'magic-string';
import { walk } from 'oxc-walker';
import type { VariableDeclarator, CallExpression } from 'oxc-parser';
import type { GwenViteOptions } from '../types.js';
import { parseSource, isCallTo, getIdentifierName, getCallArgs } from '../oxc/index.js';

const ACTORS_VIRTUAL = 'virtual:gwen/actors';
const RESOLVED_ACTORS = '\0' + ACTORS_VIRTUAL;

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
    return 'export const actors = [];\n';
  }
  const entries = actorFiles.map((f) => `  () => import('${f}')`).join(',\n');
  return `export const actors = [\n${entries},\n];\n`;
}

/**
 * Transform `defineActor` and `definePrefab` variable declarations to inject
 * name metadata as a leading comment, using AST-based parsing to avoid
 * false positives inside string literals or comments.
 *
 * @param code     - TypeScript source code to transform.
 * @param filename - File path for the parser (used in diagnostics).
 * @returns Transformed source code, or the original if no changes were made.
 *
 * @example
 * ```ts
 * // Input:
 * const Hero = defineActor(config)
 * // Output:
 * const Hero = defineActor(/* __actorName__: "Hero" *\/ config)
 * ```
 */
export function transformActorNames(code: string, filename = 'actor.ts'): string {
  if (!code.includes('defineActor') && !code.includes('definePrefab')) return code;

  const parsed = parseSource(filename, code);
  if (!parsed) return code;

  const s = new MagicString(code);
  let changed = false;

  walk(parsed.program, {
    enter(node) {
      if (node.type !== 'VariableDeclarator') return;
      const { id, init } = node as VariableDeclarator;
      if (id.type !== 'Identifier') return;
      if (!init) return;
      if (!isCallTo(init, 'defineActor') && !isCallTo(init, 'definePrefab')) return;

      const varName = (id as { name: string }).name;
      const callee = getIdentifierName((init as CallExpression).callee);
      const metaKey = callee === 'defineActor' ? '__actorName__' : '__prefabName__';

      const args = getCallArgs(init as CallExpression);
      if (args.length > 0) {
        s.prependLeft(args[0]!.start, `/* ${metaKey}: "${varName}" */ `);
      } else {
        s.prependLeft(init.end - 1, `/* ${metaKey}: "${varName}" */ `);
      }
      changed = true;
    },
  });

  return changed ? s.toString() : code;
}

/**
 * Recursively scans a directory for actor source files (`.ts`, excluding
 * `.test.ts` and `.d.ts`).
 *
 * @param dir - Absolute path to the directory to scan.
 * @returns Sorted list of absolute file paths.
 */
function scanActorDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      result.push(...scanActorDir(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      result.push(full);
    }
  }
  return result;
}

/**
 * GWEN sub-plugin for actor auto-discovery, virtual module generation, and HMR.
 *
 * - Provides `virtual:gwen/actors` with lazy imports for all files in `src/actors/`
 * - Invalidates the virtual module on file changes in the actors directory
 * - Injects `__actorName__` and `__prefabName__` debug names via simple transforms
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
    return { name: 'gwen:actor' };
  }

  const actorDir = options.actors.dir ?? 'src/actors';
  const hmrEnabled = options.actors.hmr !== false;
  let root = process.cwd();

  return {
    name: 'gwen:actor',

    configResolved(config) {
      root = config.root;
    },

    resolveId(id) {
      if (id === ACTORS_VIRTUAL) return RESOLVED_ACTORS;
    },

    load(id) {
      if (id !== RESOLVED_ACTORS) return;
      return generateActorsModule(scanActorDir(resolve(root, actorDir)));
    },

    handleHotUpdate({ file, server }: { file: string; server: ViteDevServer }) {
      if (!hmrEnabled) return;
      if (!file.startsWith(resolve(root, actorDir))) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_ACTORS);
      if (mod) {
        server.moduleGraph.invalidateModule(mod);
        server.hot.send({ type: 'full-reload' });
      }
    },

    transform(code, id) {
      if (!id.startsWith(resolve(root, actorDir))) return;
      const transformed = transformActorNames(code);
      if (transformed === code) return;
      return { code: transformed, map: null };
    },
  };
}
