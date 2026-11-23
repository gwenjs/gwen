/**
 * `gwen:system-name` inserts `"Name", ` into `const Name = defineSystem(setup)`.
 * Two or more arguments, a spread, `let`, `var`, and `export default` stay unchanged.
 */

import type { CallExpression } from "oxc-parser";
import type { GwenSourceTransform, TransformEdit } from "../pipeline/types.js";
import { namedDeclarators } from "./named-declarator.js";

function singleUnnamedArgument(call: CallExpression): { readonly start: number } | null {
  if (call.arguments.length !== 1) return null;
  const first = call.arguments[0];
  if (first === undefined) return null;
  if (first.type === "SpreadElement") return null;
  return first;
}

export const systemName: GwenSourceTransform = {
  name: "gwen:system-name",
  run(program, ctx) {
    const edits: TransformEdit[] = [];
    for (const hit of namedDeclarators(program, ctx, "defineSystem", "const")) {
      const first = singleUnnamedArgument(hit.call);
      if (first === null) continue;
      const text = `"${hit.name}", `;
      edits.push({ kind: "insert", at: first.start, text });
    }
    return edits;
  },
};
