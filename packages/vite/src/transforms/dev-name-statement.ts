/**
 * Insert one dev-only statement after a `const` declarator.
 * The call is not wrapped. A declaration that already has the statement is skipped.
 */

import type { CallExpression, ObjectProperty, Program } from "oxc-parser";
import { walk } from "../oxc/index.js";
import type { GwenCallee, GwenSourceTransform, TransformEdit } from "../pipeline/types.js";
import { namedDeclarators } from "./named-declarator.js";

/** Whitespace before the declaration on its line. Anything else means no indent. */
function lineIndent(code: string, at: number): string {
  const lineStart = code.lastIndexOf("\n", at - 1) + 1;
  const prefix = code.slice(lineStart, at);
  for (let index = 0; index < prefix.length; index += 1) {
    const char = prefix.charCodeAt(index);
    if (char !== 32 && char !== 9) return "";
  }
  return prefix;
}

function isObjectAssign(callee: CallExpression["callee"]): boolean {
  if (callee.type !== "MemberExpression" || callee.computed || callee.optional) return false;
  if (callee.object.type !== "Identifier" || callee.object.name !== "Object") return false;
  return callee.property.type === "Identifier" && callee.property.name === "assign";
}

function propertyName(property: ObjectProperty): string | null {
  if (property.computed) return null;
  const key = property.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/** The module already holds `Object.assign(name, { key: ... })`. */
function alreadyNamed(program: Program, name: string, key: string): boolean {
  let found = false;
  walk(program, {
    enter(node) {
      if (found || node.type !== "CallExpression") return;
      if (isObjectAssign(node.callee) === false) return;
      const target = node.arguments[0];
      const props = node.arguments[1];
      if (target === undefined || props === undefined) return;
      if (target.type !== "Identifier" || target.name !== name) return;
      if (props.type !== "ObjectExpression") return;
      for (const property of props.properties) {
        if (property.type === "SpreadElement") continue;
        if (propertyName(property) === key) found = true;
      }
    },
  });
  return found;
}

export function devNameUnit(
  name: `gwen:${string}`,
  callee: GwenCallee,
  key: string,
): GwenSourceTransform {
  return {
    name,
    run(program, ctx) {
      const edits: TransformEdit[] = [];
      for (const hit of namedDeclarators(program, ctx, callee, "const")) {
        if (alreadyNamed(program, hit.name, key)) continue;
        const indent = lineIndent(ctx.code, hit.declaration.start);
        const text = `\n${indent}__GWEN_DEV__ && Object.assign(${hit.name}, { ${key}: "${hit.name}" });`;
        edits.push({ kind: "insert", at: hit.declaration.end, text });
      }
      return edits;
    },
  };
}
