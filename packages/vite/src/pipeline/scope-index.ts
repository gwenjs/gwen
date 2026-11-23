/**
 * Identifier start to the declaration that binds it.
 * Built on the first query: one walk collects, `freeze()` keeps exited scopes,
 * the second walk records. A single pass misses a hoisted function.
 */

import type { Program } from "oxc-parser";
import type { ScopeTrackerNode } from "oxc-walker";
import { ScopeTracker, walk } from "../oxc/index.js";

export interface ScopeIndex {
  /** Every Identifier of the module is recorded, binding or reference. `undefined` when `start` is not an Identifier. `null` when the name is undeclared. */
  declarationAt(start: number): ScopeTrackerNode | null | undefined;
  isRootName(name: string): boolean;
}

interface ScopeData {
  readonly declarations: Map<number, ScopeTrackerNode | null>;
  readonly rootNames: ReadonlySet<string>;
}

function addIdentifier(name: string | null, names: Set<string>): void {
  if (name === null || name.length === 0) return;
  names.add(name);
}

/** Names declared by a module-level statement. Nested bindings are not included. */
function moduleScopeNames(program: Program): Set<string> {
  const names = new Set<string>();
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      if (statement.importKind === "type") continue;
      for (const spec of statement.specifiers) {
        if (spec.type === "ImportSpecifier" && spec.importKind === "type") continue;
        names.add(spec.local.name);
      }
      continue;
    }
    if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      addIdentifier(statement.id === null ? null : statement.id.name, names);
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      for (const decl of statement.declarations) {
        if (decl.id.type === "Identifier") names.add(decl.id.name);
      }
      continue;
    }
    if (statement.type === "ExportNamedDeclaration" && statement.declaration !== null) {
      const declaration = statement.declaration;
      if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") {
        addIdentifier(declaration.id === null ? null : declaration.id.name, names);
      } else if (declaration.type === "VariableDeclaration") {
        for (const decl of declaration.declarations) {
          if (decl.id.type === "Identifier") names.add(decl.id.name);
        }
      }
    }
  }
  return names;
}

function build(program: Program): ScopeData {
  const tracker = new ScopeTracker({ preserveExitedScopes: true });
  walk(program, { scopeTracker: tracker });
  tracker.freeze();
  const declarations = new Map<number, ScopeTrackerNode | null>();
  walk(program, {
    scopeTracker: tracker,
    enter(node) {
      if (node.type !== "Identifier") return;
      declarations.set(node.start, tracker.getDeclaration(node.name));
    },
  });
  return { declarations, rootNames: moduleScopeNames(program) };
}

/** Lazy two-pass index. The first call walks; later calls reuse the maps. */
export function createScopeIndex(program: Program): ScopeIndex {
  let ready: ScopeData | undefined;

  function load(): ScopeData {
    if (ready !== undefined) return ready;
    ready = build(program);
    return ready;
  }

  return {
    declarationAt(start) {
      return load().declarations.get(start);
    },
    isRootName(name) {
      return load().rootNames.has(name);
    },
  };
}
