/**
 * `gwen:layer-inline` overwrites `L.k` from `const L = defineLayers({ ... })`.
 * The const is removed only when `L` has no remaining reference.
 * Values stay in the uint32 domain (`>>> 0`), and `>>` shifts unsigned.
 */

import type {
  Argument,
  Expression,
  Node,
  Program,
  PropertyKey,
  VariableDeclaration,
} from "oxc-parser";
import { walk } from "../oxc/index.js";
import type { GwenSourceTransform, TransformContext, TransformEdit } from "../pipeline/types.js";
import { namedDeclarators } from "./named-declarator.js";

interface LayerConst {
  readonly declaration: VariableDeclaration;
  readonly exported: boolean;
  readonly values: ReadonlyMap<string, number>;
  rewrites: number;
  refs: number;
}

export function evalConstInt(node: Expression): number | null {
  if (node.type === "ParenthesizedExpression") return evalConstInt(node.expression);
  if (node.type === "Literal") {
    if (typeof node.value !== "number" || !Number.isInteger(node.value)) return null;
    if (node.value < 0 || node.value > 4294967295) return null;
    return node.value >>> 0;
  }
  if (node.type === "UnaryExpression") {
    if (node.operator !== "~") return null;
    const inner = evalConstInt(node.argument);
    if (inner === null) return null;
    return ~inner >>> 0;
  }
  if (node.type !== "BinaryExpression") return null;
  return evalBinary(node);
}

function evalBinary(node: Expression): number | null {
  if (node.type !== "BinaryExpression") return null;
  const operator = node.operator;
  if (
    operator !== "<<" &&
    operator !== ">>" &&
    operator !== ">>>" &&
    operator !== "|" &&
    operator !== "&" &&
    operator !== "^"
  ) {
    return null;
  }
  const left = evalConstInt(node.left);
  const right = evalConstInt(node.right);
  if (left === null || right === null) return null;
  if (operator === "<<") return (left << right) >>> 0;
  if (operator === ">>") return left >>> right;
  if (operator === ">>>") return left >>> right;
  if (operator === "|") return (left | right) >>> 0;
  if (operator === "&") return (left & right) >>> 0;
  return (left ^ right) >>> 0;
}

function staticKey(key: PropertyKey): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

/** `null` skips the whole declaration: one bad property means no edit. */
function readTable(argument: Argument | undefined): Map<string, number> | null {
  if (argument === undefined || argument.type !== "ObjectExpression") return null;
  const table = new Map<string, number>();
  for (const property of argument.properties) {
    if (property.type !== "Property") return null;
    if (property.computed || property.shorthand || property.method || property.kind !== "init") {
      return null;
    }
    const key = staticKey(property.key);
    if (key === null) return null;
    const value = evalConstInt(property.value);
    if (value === null) return null;
    table.set(key, value);
  }
  return table;
}

function isExported(program: Program, declaration: VariableDeclaration): boolean {
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.declaration === declaration) return true;
  }
  return false;
}

function isWriteTarget(member: Node, parent: Node | null): boolean {
  if (parent === null) return false;
  if (parent.type === "AssignmentExpression" && parent.left === member) return true;
  if (parent.type === "UpdateExpression" && parent.argument === member) return true;
  return (
    parent.type === "UnaryExpression" && parent.operator === "delete" && parent.argument === member
  );
}

/**
 * The walker only yields the immediate parent. A member inside `{ p: L.a }` is a
 * read, while the same shape under an assignment pattern or a `for` left is a write.
 * Those write targets are collected by start offset before the rewrite walk.
 */
function collectPatternMembers(node: Node, starts: Set<number>): void {
  if (node.type === "MemberExpression") {
    starts.add(node.start);
    return;
  }
  if (node.type === "AssignmentPattern") {
    collectPatternMembers(node.left, starts);
    return;
  }
  if (node.type === "RestElement") {
    collectPatternMembers(node.argument, starts);
    return;
  }
  if (node.type === "ObjectPattern") {
    for (const property of node.properties) {
      if (property.type === "RestElement") {
        collectPatternMembers(property.argument, starts);
        continue;
      }
      collectPatternMembers(property.value, starts);
    }
    return;
  }
  if (node.type !== "ArrayPattern") return;
  for (const element of node.elements) {
    if (element === null) continue;
    collectPatternMembers(element, starts);
  }
}

function patternMemberStarts(program: Program): Set<number> {
  const starts = new Set<number>();
  walk(program, {
    enter(node) {
      if (node.type === "AssignmentExpression") {
        collectPatternMembers(node.left, starts);
        return;
      }
      if (node.type !== "ForInStatement" && node.type !== "ForOfStatement") return;
      if (node.left.type === "VariableDeclaration") return;
      collectPatternMembers(node.left, starts);
    },
  });
  return starts;
}

/** Property names, non-shorthand keys, labels, and the declarator id are not references. */
function isSkippedIdentifier(node: Node, parent: Node | null): boolean {
  if (parent === null) return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return true;
  if (parent.type === "MemberExpression" && parent.computed === false && parent.property === node) {
    return true;
  }
  if (
    parent.type === "Property" &&
    parent.computed === false &&
    parent.shorthand === false &&
    parent.key === node
  ) {
    return true;
  }
  if (parent.type === "LabeledStatement" && parent.label === node) return true;
  if (parent.type === "BreakStatement" && parent.label === node) return true;
  if (parent.type === "ContinueStatement" && parent.label === node) return true;
  return false;
}

function layerEdits(program: Program, ctx: TransformContext): TransformEdit[] {
  function resolvesBinding(name: string, at: number): boolean {
    return ctx.isModuleScopeBinding(name, at);
  }

  const layers = new Map<string, LayerConst>();
  for (const hit of namedDeclarators(program, ctx, "defineLayers", "const")) {
    if (!ctx.isModuleScopeBinding(hit.name, hit.declarator.id.start)) continue;
    const table = readTable(hit.call.arguments[0]);
    if (table === null) continue;
    layers.set(hit.name, {
      declaration: hit.declaration,
      exported: isExported(program, hit.declaration),
      values: table,
      rewrites: 0,
      refs: 0,
    });
  }

  const edits: TransformEdit[] = [];
  const consumed = new Set<number>();
  const patternMembers = patternMemberStarts(program);
  walk(program, {
    enter(node, parent) {
      if (node.type === "MemberExpression") {
        if (node.computed || node.optional) return;
        if (node.property.type !== "Identifier") return;
        if (node.object.type !== "Identifier") return;
        const object = node.object;
        const binding = layers.get(object.name);
        if (binding === undefined) return;
        if (!resolvesBinding(object.name, object.start)) return;
        const value = binding.values.get(node.property.name);
        if (value === undefined) return;
        if (patternMembers.has(node.start)) return;
        if (isWriteTarget(node, parent)) return;
        consumed.add(object.start);
        binding.rewrites += 1;
        const text =
          parent !== null && parent.type === "MemberExpression" && parent.object === node
            ? `(${String(value)})`
            : String(value);
        edits.push({
          kind: "overwrite",
          start: node.start,
          end: node.end,
          text,
        });
        return;
      }
      if (node.type !== "Identifier") return;
      if (isSkippedIdentifier(node, parent)) return;
      const binding = layers.get(node.name);
      if (binding === undefined) return;
      if (!resolvesBinding(node.name, node.start)) return;
      if (consumed.has(node.start)) return;
      binding.refs += 1;
    },
  });

  for (const binding of layers.values()) {
    if (
      binding.rewrites > 0 &&
      binding.refs === 0 &&
      !binding.exported &&
      binding.declaration.declarations.length === 1
    ) {
      edits.push({
        kind: "remove",
        start: binding.declaration.start,
        end: binding.declaration.end,
      });
    }
  }
  return edits;
}

export const layerInlineTransform: GwenSourceTransform = {
  name: "gwen:layer-inline",
  run(program, ctx) {
    return layerEdits(program, ctx);
  },
};
