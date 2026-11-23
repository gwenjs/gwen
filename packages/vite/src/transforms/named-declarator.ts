/**
 * Variable declarators whose initializer calls `callee`, resolved by import binding.
 * `export const` is the inner declaration. `kind` keeps one declaration kind.
 */

import type { CallExpression, Program, VariableDeclaration, VariableDeclarator } from "oxc-parser";
import { walk } from "../oxc/index.js";
import type { GwenCallee, TransformContext } from "../pipeline/types.js";

export interface NamedDeclarator {
  readonly name: string;
  readonly declaration: VariableDeclaration;
  readonly declarator: VariableDeclarator;
  readonly call: CallExpression;
}

export function* namedDeclarators(
  program: Program,
  ctx: TransformContext,
  callee: GwenCallee,
  kind?: VariableDeclaration["kind"],
): Generator<NamedDeclarator> {
  const found: NamedDeclarator[] = [];
  walk(program, {
    enter(node) {
      if (node.type !== "VariableDeclaration") return;
      if (kind !== undefined && node.kind !== kind) return;
      for (const declarator of node.declarations) {
        const id = declarator.id;
        const init = declarator.init;
        if (id.type !== "Identifier") continue;
        if (init === null || init.type !== "CallExpression") continue;
        const bound = ctx.resolveCallee(init);
        if (bound !== callee) continue;
        found.push({
          name: id.name,
          declaration: node,
          declarator,
          call: init,
        });
      }
    },
  });
  for (const item of found) yield item;
}
