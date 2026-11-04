import { resolve } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import MagicString from "magic-string";
import type { GwenViteOptions } from "../types.js";
import { parseSource, isCallTo, getIdentifierName, getCallArgs } from "../oxc/index.js";
import type { ArrowFunctionExpression, Function as OxcFunction } from "oxc-parser";
import { walk } from "oxc-walker";
import { createVirtualModule } from "../shared/virtual-module.js";
import { findComponentFiles } from "../optimizer/component-scanner.js";

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
 * Walk the AST of a `defineActor` factory argument and collect the identifier
 * names passed to `useActor()` calls at any depth.
 *
 * Only handles static identifiers — computed or dynamic arguments
 * (e.g. `useActor(pool[i])`) are silently skipped.
 *
 * @param factory - The factory argument node (arrow function or function expression).
 * @returns Deduplicated array of identifier names, e.g. `['LaserActor', 'ParticleActor']`.
 *
 * @example
 * ```ts
 * // Given: defineActor(Prefab, () => { const x = useActor(LaserActor); return {} })
 * // Returns: ['LaserActor']
 * ```
 *
 * @internal Exported for unit tests.
 */
export function extractUseActorNames(factory: ArrowFunctionExpression | OxcFunction): string[] {
  const seen = new Set<string>();

  walk(factory, {
    enter(node) {
      if (node.type !== "CallExpression") return;
      if (!isCallTo(node, "useActor")) return;
      const first = getCallArgs(node)[0];
      if (!first) return;
      const name = getIdentifierName(first);
      if (name) seen.add(name);
    },
  });

  return Array.from(seen);
}

/**
 * Transform `defineActor` and `definePrefab` variable declarations to inject
 * name metadata.
 *
 * - `defineActor`: injects the variable name as a **string literal** first argument,
 *   matching the pattern used by `transformSystemNames` for `defineSystem`.
 *   Skipped if the first argument is already a string literal.
 * - `definePrefab`: keeps the existing comment injection (`__prefabName__: "Foo"`)
 *   because `definePrefab` does not accept a name argument.
 *
 * @param code     - TypeScript source code to transform.
 * @param filename - File path for the parser (used in diagnostics).
 * @returns Transformed source code, or the original if no changes were made.
 *
 * @example
 * ```ts
 * // defineActor — input:
 * const Hero = defineActor(HeroPrefab, factory)
 * // defineActor — output:
 * const Hero = defineActor('Hero', HeroPrefab, factory)
 *
 * // definePrefab — unchanged comment form:
 * const HeroPrefab = definePrefab(/* __prefabName__: "HeroPrefab" *\/ [...])
 * ```
 */
export function transformActorNames(code: string, filename = "actor.ts"): string {
  if (!code.includes("defineActor") && !code.includes("definePrefab")) return code;

  const parsed = parseSource(filename, code);
  if (!parsed) return code;

  const s = new MagicString(code);
  let changed = false;

  walk(parsed.program, {
    enter(node) {
      // Walk VariableDeclaration (not VariableDeclarator) so we have the full
      // statement end position, which is needed to cleanly append _deps on the
      // next line without displacing the trailing semicolon.
      if (node.type !== "VariableDeclaration") return;

      // VariableDeclaration has a `declarations` array — only handle the
      // simple single-declarator form (`const Foo = ...`).
      const varDecl = node;
      const [declarator] = varDecl.declarations;
      if (varDecl.declarations.length !== 1 || !declarator) return;

      const { id, init } = declarator;
      if (id.type !== "Identifier" || !id.name) return;
      if (!init || init.type !== "CallExpression") return;
      if (!isCallTo(init, "defineActor") && !isCallTo(init, "definePrefab")) return;

      const varName = id.name;
      const callee = getIdentifierName(init.callee);
      const args = getCallArgs(init);
      const firstArg = args[0];

      if (callee === "defineActor") {
        // ── Name injection (unchanged behaviour) ──────────────────────────
        if (!firstArg || firstArg.type !== "Literal") {
          if (firstArg) {
            s.prependLeft(firstArg.start, `'${varName}', `);
          } else {
            s.prependLeft(init.end - 1, `'${varName}'`);
          }
          changed = true;
        }

        // ── _deps injection ───────────────────────────────────────────────
        // Locate the factory argument: it is the last arg whose type is an
        // arrow function or regular function expression.
        const factoryArg = args[args.length - 1];
        if (
          factoryArg &&
          (factoryArg.type === "ArrowFunctionExpression" ||
            factoryArg.type === "FunctionExpression")
        ) {
          const deps = extractUseActorNames(factoryArg);
          if (deps.length > 0) {
            const depsList = deps.map((d) => `${d}._plugin`).join(", ");
            s.appendLeft(varDecl.end, `\n${varName}._plugin._deps = [${depsList}]`);
            changed = true;
          }
        }
      } else {
        // definePrefab — keep comment injection (unchanged behaviour)
        const metaKey = "__prefabName__";
        if (firstArg) {
          s.prependLeft(firstArg.start, `/* ${metaKey}: "${varName}" */ `);
        } else {
          s.prependLeft(init.end - 1, `/* ${metaKey}: "${varName}" */ `);
        }
        changed = true;
      }
    },
  });

  return changed ? s.toString() : code;
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

    transform(code, id) {
      if (!id.startsWith(resolve(root, actorDir))) return;
      const transformed = transformActorNames(code);
      if (transformed === code) return;
      return { code: transformed, map: null };
    },
  };
}
