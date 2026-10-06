/**
 * @file AST helpers for reading configuration from source files.
 *
 * Provides utilities to extract metadata from TypeScript/JavaScript source,
 * particularly from `export default { ... }` config objects.
 */

import { parseSource } from "./parse.js";
import { walk } from "oxc-walker";
import { getObjectProperties, getPropertyKeyName, getStringValue } from "./helpers.js";
import type { Node, ObjectExpression, ObjectProperty, ArrayExpression } from "oxc-parser";

/**
 * Find the ObjectExpression from `export default { ... }` in source.
 * Returns `null` if absent or if `export default` is not an object literal.
 *
 * @param source - TypeScript/JavaScript source code.
 * @returns The ObjectExpression node, or null.
 *
 * @example
 * ```ts
 * const obj = findDefaultExportObject(source);
 * if (obj) { ... process object properties ... }
 * ```
 */
export function findDefaultExportObject(source: string): ObjectExpression | null {
  const result = parseSource("config.ts", source);
  if (!result) return null;

  let found: ObjectExpression | null = null;

  walk(result.program, {
    enter(node: Node) {
      if (node.type !== "ExportDefaultDeclaration") return;
      if (node.declaration.type !== "ObjectExpression") return;
      found = node.declaration;
    },
  });

  return found;
}

/**
 * Read a `string[]` property by key from an ObjectExpression.
 * Returns `[]` if the property is missing or not an ArrayExpression.
 * String literals within the array are extracted; non-string elements are skipped.
 *
 * @param obj - The ObjectExpression node to read from.
 * @param key - The property key name to read.
 * @returns Array of string values, or empty array if absent/wrong type.
 *
 * @example
 * ```ts
 * const modules = readStringArrayProp(obj, 'modules'); // ['@scope/pkg', ...]
 * ```
 */
export function readStringArrayProp(obj: ObjectExpression, key: string): string[] {
  const props = getObjectProperties(obj);

  const prop = props.find((p: ObjectProperty) => {
    const keyName = getPropertyKeyName(p);
    return keyName === key;
  });

  if (!prop) return [];

  const { value } = prop as ObjectProperty;
  if (value.type !== "ArrayExpression") return [];

  const arr = value as ArrayExpression;
  const result: string[] = [];

  for (const el of arr.elements) {
    if (!el || el.type === "SpreadElement") continue;
    const str = getStringValue(el);
    if (str !== null) result.push(str);
  }

  return result;
}
