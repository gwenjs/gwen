import MagicString from "magic-string";
import { walk } from "oxc-walker";
import type { VariableDeclarator, CallExpression } from "oxc-parser";
import { parseSource, isCallTo, getCallArgs } from "../oxc/index.js";

/**
 * Describes what to inject when a matching `VariableDeclarator` is found.
 *
 * @param varName - The declared variable name (e.g. `"ScoreSystem"`).
 * @param args    - The arguments of the matched call expression.
 * @param s       - The MagicString instance — apply mutations directly to it.
 * @returns `true` if a mutation was applied, `false` to skip this node.
 */
export type AstInjectorFn = (
  varName: string,
  args: ReturnType<typeof getCallArgs>,
  s: MagicString,
  init: CallExpression,
) => boolean;

/**
 * Creates a source-code transformer that walks `VariableDeclarator` nodes,
 * finds calls to `targetFn`, and delegates the mutation to `inject`.
 *
 * Eliminates the boilerplate shared by `transformSystemNames`,
 * `transformLayoutNames`, and the name-injection part of `transformActorNames`:
 * parse → walk → find matching call → apply MagicString mutation.
 *
 * @param targetFn - The function name to match (e.g. `"defineSystem"`).
 * @param inject   - Called for each matching node to apply the mutation.
 * @returns A transform function `(code, filename) => string`.
 *
 * @example
 * ```ts
 * export const transformSystemNames = createAstNameInjector(
 *   "defineSystem",
 *   (varName, args, s) => {
 *     if (args.length > 0 && args[0]!.type !== "Literal") {
 *       s.prependLeft(args[0]!.start, `'${varName}', `);
 *       return true;
 *     }
 *     return false;
 *   },
 * );
 * ```
 */
export function createAstNameInjector(
  targetFn: string,
  inject: AstInjectorFn,
): (code: string, filename?: string) => string {
  return function transform(code: string, filename = "unknown.ts"): string {
    if (!code.includes(targetFn)) return code;

    const parsed = parseSource(filename, code);
    if (!parsed) return code;

    const s = new MagicString(code);
    let changed = false;

    walk(parsed.program, {
      enter(node) {
        if (node.type !== "VariableDeclarator") return;
        const { id, init } = node as VariableDeclarator;
        if (id.type !== "Identifier") return;
        if (!init || !isCallTo(init, targetFn)) return;

        const varName = (id as { name: string }).name;
        const args = getCallArgs(init as CallExpression);

        if (inject(varName, args, s, init as CallExpression)) {
          changed = true;
        }
      },
    });

    return changed ? s.toString() : code;
  };
}
