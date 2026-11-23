/**
 * Resolve callees for one module from its import table, scope index and auto-imports.
 * A `var` in a nested block of the same function is outside ScopeTracker 0.7 and stays unresolved.
 */

import type { AutoImport } from "@gwenjs/kit";
import type { Argument, CallExpression, MemberExpression, Node, Program } from "oxc-parser";
import { walk } from "../oxc/index.js";
import { calleeFor, isVirtualSource } from "./canonical.js";
import { buildImportTable, type ImportBinding } from "./import-table.js";
import { createScopeIndex, type ScopeIndex } from "./scope-index.js";
import type {
  GwenAstArgument,
  GwenAstNode,
  GwenCallee,
  GwenCallSite,
  GwenImportBinding,
} from "./types.js";
import type { ScopeTrackerNode } from "oxc-walker";

export interface ModuleResolverInput {
  readonly program: Program;
  readonly code: string;
  readonly id: string;
  readonly autoImports: readonly AutoImport[];
  /** Origin binding per local import name. The barrel pass fills it before units run. */
  readonly followed: ReadonlyMap<string, GwenImportBinding>;
}

export interface ModuleResolver {
  resolveCallee(node: CallExpression): GwenCallee | null;
  resolveImport(node: Node): GwenImportBinding | null;
  calls(): readonly GwenCallSite[];
  isModuleScopeBinding(name: string, at: number): boolean;
}

interface NamedStart {
  readonly name: string;
  readonly start: number;
}

function astNode(node: Node): GwenAstNode {
  return { type: node.type, start: node.start, end: node.end };
}

function isOptional(node: { optional: boolean }): boolean {
  return node.optional;
}

/** Property name of a member. Computed members are rejected by the caller. */
function propertyName(node: MemberExpression): string | null {
  const property = node.property;
  if (property.type === "Identifier") return property.name;
  if (property.type === "Literal" && typeof property.value === "string") return property.value;
  return null;
}

function declaredName(declaration: ScopeTrackerNode): string | null {
  if (declaration.type === "Import") return declaration.node.local.name;
  if (declaration.type === "Variable" || declaration.type === "Identifier") {
    return declaration.node.name;
  }
  if (declaration.type === "Function") {
    const id = declaration.node.id;
    if (id === null) return null;
    return id.name;
  }
  if (declaration.node.type === "Identifier") return declaration.node.name;
  return null;
}

function classifyArgument(argument: Argument): GwenAstArgument {
  if (argument.type === "Literal" && typeof argument.value === "string") {
    return { kind: "string", value: argument.value, start: argument.start, end: argument.end };
  }
  if (argument.type === "Literal" && typeof argument.value === "number") {
    return { kind: "number", value: argument.value, start: argument.start, end: argument.end };
  }
  return { kind: "other", node: astNode(argument), start: argument.start, end: argument.end };
}

export function createModuleResolver(input: ModuleResolverInput): ModuleResolver {
  const { program, code, autoImports, followed } = input;
  const scope: ScopeIndex = createScopeIndex(program);
  let table: Map<string, ImportBinding> | undefined;
  let cachedCalls: readonly GwenCallSite[] | undefined;

  function imports(): Map<string, ImportBinding> {
    if (table === undefined) table = buildImportTable(program);
    return table;
  }

  function fromAutoImport(localName: string): GwenImportBinding | null {
    for (const entry of autoImports) {
      const local = entry.as ?? entry.name;
      if (local !== localName) continue;
      return { source: entry.from, imported: entry.name };
    }
    return null;
  }

  function publish(row: ImportBinding, imported: string): GwenImportBinding | null {
    if (isVirtualSource(row.source)) return fromAutoImport(imported);
    return { source: row.source, imported };
  }

  function namespaceRow(object: NamedStart): ImportBinding | null {
    const declaration = scope.declarationAt(object.start);
    if (declaration === undefined || declaration === null) return null;
    if (declaration.type !== "Import") return null;
    const row = imports().get(object.name);
    if (row === undefined || row.kind !== "namespace") return null;
    return row;
  }

  function resolveMember(node: MemberExpression): GwenImportBinding | null {
    if (isOptional(node) || node.computed) return null;
    const imported = propertyName(node);
    if (imported === null) return null;
    if (node.object.type !== "Identifier") return null;
    const row = namespaceRow(node.object);
    if (row === null) return null;
    return publish(row, imported);
  }

  function resolveIdentifier(node: NamedStart): GwenImportBinding | null {
    const declaration = scope.declarationAt(node.start);
    if (declaration === undefined) return null;
    if (declaration === null) return fromAutoImport(node.name);
    if (declaration.type !== "Import") return null;
    const row = imports().get(node.name);
    if (row === undefined || row.kind === "namespace") return null;
    if (isVirtualSource(row.source)) return fromAutoImport(row.imported);
    const over = followed.get(node.name);
    if (over !== undefined) return over;
    return { source: row.source, imported: row.imported };
  }

  function resolveCall(node: CallExpression): GwenImportBinding | null {
    if (isOptional(node)) return null;
    return resolveImport(node.callee);
  }

  function resolveImport(node: Node): GwenImportBinding | null {
    if (node.type === "ChainExpression") return resolveImport(node.expression);
    if (node.type === "CallExpression") return resolveCall(node);
    if (node.type === "MemberExpression") return resolveMember(node);
    if (node.type === "Identifier") return resolveIdentifier(node);
    return null;
  }

  function resolveCallee(node: CallExpression): GwenCallee | null {
    const binding = resolveImport(node);
    if (binding === null) return null;
    return calleeFor(binding.source, binding.imported);
  }

  function toCallSite(node: CallExpression): GwenCallSite {
    const args: GwenAstArgument[] = [];
    for (const argument of node.arguments) args.push(classifyArgument(argument));
    return {
      start: node.start,
      end: node.end,
      binding: resolveImport(node),
      arguments: args,
      node: astNode(node),
    };
  }

  function collectCalls(): readonly GwenCallSite[] {
    const found: GwenCallSite[] = [];
    walk(program, {
      enter(node) {
        if (node.type !== "CallExpression") return;
        found.push(toCallSite(node));
      },
    });
    return found;
  }

  function calls(): readonly GwenCallSite[] {
    if (cachedCalls === undefined) cachedCalls = collectCalls();
    return cachedCalls;
  }

  function isModuleScopeBinding(name: string, at: number): boolean {
    if (at < 0 || at > code.length) return false;
    const declaration = scope.declarationAt(at);
    if (declaration === undefined) return scope.isRootName(name);
    if (declaration === null) return false;
    if (declaration.scope !== "") return false;
    return declaredName(declaration) === name;
  }

  return { resolveCallee, resolveImport, calls, isModuleScopeBinding };
}
