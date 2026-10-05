import type { Plugin } from "vite";
import MagicString from "magic-string";
import { walk, parseSource } from "../oxc/index.js";
import { getCallArgs, getArrayElements, getIdentifierName } from "../oxc/index.js";

/**
 * Vite plugin that hoists static `useQuery([...])` array literals to module level
 * and pre-computes their LRU cache keys at build time.
 *
 * Transforms:
 * ```ts
 * const entities = useQuery([Position, Velocity]);
 * // becomes:
 * const _q0 = [Position, Velocity];
 * const entities = useQuery(_q0, 'Position|Velocity');
 * ```
 *
 * Does NOT transform dynamic arrays, spreads, or non-identifier elements.
 * Must run after gwenAstNameInjectorPlugin to ensure component names are stable.
 *
 * @returns A Vite plugin with `transform()` hook
 *
 * @example
 * ```ts
 * export function gwenVitePlugin(options: GwenViteOptions = {}): PluginOption {
 *   return [
 *     gwenAstNameInjectorPlugin(),  // 1. Inject .name into component definitions
 *     gwenQueryHoistPlugin(),       // 2. Hoist useQuery arrays (names already stable)
 *     // ... other plugins
 *   ];
 * }
 * ```
 */
export function gwenQueryHoistPlugin(): Plugin {
  return {
    name: "gwen:query-hoist",

    transform(code: string, id: string) {
      // Quick file filter: only process TS/TSX and only if useQuery is present
      if (!id.endsWith(".ts") && !id.endsWith(".tsx")) return;
      if (!code.includes("useQuery")) return;

      const parsed = parseSource(id, code);
      if (!parsed) return;

      const s = new MagicString(code);
      const hoisted: string[] = [];
      let counter = 0;
      let changed = false;

      // Collect all edits first (in reverse order for offset stability)
      const edits: Array<{ start: number; end: number; replacement: string }> = [];

      walk(parsed.program, {
        // boundary: oxc walk callback is untyped, owned by #66
        enter(node: any) {
          // Look for VariableDeclarator (const/let/var x = ...)
          if (node.type !== "VariableDeclarator") return;

          const { id: declId, init } = node;
          if (!declId || declId.type !== "Identifier") return;
          if (!init || init.type !== "CallExpression") return;

          // Check if the call is to 'useQuery'
          const callExpr = init;
          if (callExpr.callee?.type !== "Identifier" || callExpr.callee.name !== "useQuery") {
            return;
          }

          // Get the first argument
          const args = getCallArgs(callExpr);
          if (args.length < 1) return;

          const firstArg = args[0]!;
          if (firstArg.type !== "ArrayExpression") return;

          // Get all array elements (getArrayElements filters spreads and nulls)
          const elements = getArrayElements(firstArg);
          if (elements.length === 0) return;

          // If the original array had spreads/holes, getArrayElements would filter them,
          // but we want to detect and skip arrays with spreads entirely
          // boundary: oxc array elements include holes, owned by #66
          const rawArray = firstArg as any;
          if (rawArray.elements && rawArray.elements.length !== elements.length) {
            // Array had spreads or holes — skip it
            return;
          }

          const allIdentifiers = elements.every((el) => el.type === "Identifier");
          if (!allIdentifiers) return;

          // Extract identifier names and sort for canonical cache key
          const names = elements
            .map((el) => getIdentifierName(el))
            .filter((name): name is string => name !== null);

          if (names.length !== elements.length) return;

          const sortedNames = [...names].sort();
          const cacheKey = sortedNames.join("|");
          const varName = `_q${counter++}`;

          // Record the hoisted declaration
          hoisted.push(`const ${varName} = [${names.join(", ")}];`);

          // Record the replacement: replace the array with variable and cache key
          edits.push({
            start: firstArg.start,
            end: firstArg.end,
            replacement: `${varName}, '${cacheKey}'`,
          });

          changed = true;
        },
      });

      if (!changed) return;

      // Apply all edits in reverse order to preserve positions
      for (const edit of edits.reverse()) {
        s.overwrite(edit.start, edit.end, edit.replacement);
      }

      // Find where to insert hoisted declarations (after last import)
      let insertAt = 0;
      for (const node of parsed.program.body) {
        if (node.type === "ImportDeclaration") {
          // boundary: oxc node end offset, owned by #66
          insertAt = (node as any).end;
        }
      }

      // Insert hoisted declarations at the appropriate position
      const insertText = hoisted.length > 0 ? "\n" + hoisted.join("\n") + "\n" : "";
      if (insertText) {
        s.appendLeft(insertAt, insertText);
      }

      return { code: s.toString(), map: null };
    },
  };
}
