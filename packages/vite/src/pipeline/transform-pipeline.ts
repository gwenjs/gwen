/**
 * One AST pass per module. Units share that program and never re-parse.
 * `resolveCallee` matches a direct named import of a canonical callee only.
 * Alias, namespace, barrel, and auto-import are P-66-1b.
 * `isModuleScopeBinding` is true only for a top-level binding. Nested
 * shadowing is also P-66-1b (a ScopeTracker walk), not this stub.
 */

import type { CallExpression, Program } from "oxc-parser";
import type { Plugin } from "vite";
import type { AutoImport } from "@gwenjs/kit";
import { GwenError } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import { applyEdits } from "./apply-edits.js";
import { devHint } from "./dev-hint.js";
import { lineColumn, parseModule, pathWithoutQuery } from "./parse.js";
import type {
  GwenCallee,
  GwenCallSite,
  GwenImportBinding,
  GwenSourceTransform,
  TransformContext,
  TransformEdit,
} from "./types.js";

/** In-plugin handle. `register` is refused after `configResolved`. */
export interface GwenTransformPipelineApi {
  register(t: GwenSourceTransform): void;
  readonly names: readonly string[];
}

const CANONICAL_CALLEES: readonly GwenCallee[] = [
  "defineSystem",
  "onUpdate",
  "useQuery",
  "useComponent",
  "defineScene",
  "onEnter",
  "onExit",
  "onPreload",
  "onTransitionExit",
  "defineSceneRouter",
  "defineActor",
  "definePrefab",
  "useActor",
  "defineLayout",
  "withAsyncContext",
  "defineLayers",
  "useMeshCollider",
];

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mts|cts)$/;

interface SourceLoc {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

function canonicalName(name: string): GwenCallee | null {
  for (const item of CANONICAL_CALLEES) {
    if (item === name) return item;
  }
  return null;
}

function importedName(imported: { type: string; name?: string; value?: string }): string {
  if (imported.type === "Identifier" && imported.name !== undefined) return imported.name;
  if (imported.value !== undefined) return imported.value;
  return "";
}

/** Local name → canonical callee, for direct named value imports only. */
function directCallees(program: Program): Map<string, GwenCallee> {
  const found = new Map<string, GwenCallee>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    for (const spec of statement.specifiers) {
      if (spec.type !== "ImportSpecifier") continue;
      if (spec.importKind === "type") continue;
      const canonical = canonicalName(importedName(spec.imported));
      if (canonical === null) continue;
      found.set(spec.local.name, canonical);
    }
  }
  return found;
}

function addIdentifier(name: string | null, names: Set<string>): void {
  if (name === null || name.length === 0) return;
  names.add(name);
}

function collectTopLevel(program: Program): Set<string> {
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

function acceptsModule(id: string): boolean {
  if (id.startsWith("\0")) return false;
  if (id.includes("/node_modules/")) return false;
  const path = pathWithoutQuery(id);
  if (path.endsWith(".d.ts")) return false;
  return SOURCE_FILE.test(path);
}

function isSourceLoc(value: unknown): value is SourceLoc {
  if (typeof value !== "object" || value === null) return false;
  if (!("file" in value) || !("line" in value) || !("column" in value)) return false;
  return (
    typeof value.file === "string" &&
    typeof value.line === "number" &&
    typeof value.column === "number"
  );
}

function readOwnLoc(err: GwenError): SourceLoc | undefined {
  const loc: unknown = Object.getOwnPropertyDescriptor(err, "loc")?.value;
  if (!isSourceLoc(loc)) return undefined;
  return loc;
}

function tagEdit(edit: TransformEdit, unit: string): TransformEdit & { unit: string } {
  if (edit.kind === "insert") return { kind: "insert", at: edit.at, text: edit.text, unit };
  if (edit.kind === "overwrite") {
    return { kind: "overwrite", start: edit.start, end: edit.end, text: edit.text, unit };
  }
  return { kind: "remove", start: edit.start, end: edit.end, unit };
}

function createContext(
  id: string,
  code: string,
  program: Program,
  comments: TransformContext["comments"],
): TransformContext {
  const callees = directCallees(program);
  const topLevel = collectTopLevel(program);
  return {
    id,
    code,
    comments,
    resolveCallee(node: CallExpression): GwenCallee | null {
      if (node.callee.type !== "Identifier") return null;
      return callees.get(node.callee.name) ?? null;
    },
    calls(): readonly GwenCallSite[] {
      return [];
    },
    resolveImport(): GwenImportBinding | null {
      return null;
    },
    isModuleScopeBinding(name: string, at: number): boolean {
      if (at < 0 || at > code.length) return false;
      return topLevel.has(name);
    },
    raise(errorCode, node, what, hint): never {
      const place = lineColumn(code, node.start);
      const hintText = hint === undefined ? undefined : devHint(hint);
      const error = new GwenError(errorCode, what, { composable: "gwen", hint: hintText });
      // Vite's `generateCodeFrame` and `originalPositionFor` take a 0-based column.
      throw Object.assign(error, {
        loc: { file: id, line: place.line, column: place.column - 1 },
      });
    },
  };
}

export function createTransformPipeline(options: {
  units: GwenSourceTransform[];
  autoImports?: readonly AutoImport[];
}): Plugin & { api: GwenTransformPipelineApi } {
  const builtIns = [...options.units];
  const registered: GwenSourceTransform[] = [];
  let ordered: readonly GwenSourceTransform[] = builtIns;
  let frozen = false;

  function orderUnits(
    builtIns: readonly GwenSourceTransform[],
    registered: readonly GwenSourceTransform[],
  ): GwenSourceTransform[] {
    return [...builtIns, ...registered];
  }

  function currentUnits(): readonly GwenSourceTransform[] {
    if (frozen) return ordered;
    return orderUnits(builtIns, registered);
  }

  const api: GwenTransformPipelineApi = {
    register(unit): void {
      if (frozen) {
        throw new GwenError(
          ViteErrorCodes.TRANSFORM_UNSUPPORTED,
          "register() was called after configResolved.",
          { composable: "gwen" },
        );
      }
      registered.push(unit);
    },
    get names(): readonly string[] {
      return currentUnits().map((unit) => unit.name);
    },
  };

  const plugin: Plugin & { api: GwenTransformPipelineApi } = {
    name: "gwen:transform-pipeline",
    enforce: "pre",
    configResolved() {
      ordered = orderUnits(builtIns, registered);
      frozen = true;
    },
    async transform(code, id) {
      if (!acceptsModule(id)) return null;
      try {
        const parsed = parseModule(id, code);
        const context = createContext(id, code, parsed.program, parsed.comments);
        const tagged: Array<TransformEdit & { unit: string }> = [];
        for (const unit of currentUnits()) {
          const produced = await unit.run(parsed.program, context);
          for (const edit of produced) tagged.push(tagEdit(edit, unit.name));
        }
        const applied = applyEdits(id, code, tagged);
        if (applied === null) return null;
        return {
          code: applied.code,
          map: applied.s.generateMap({ hires: true, source: id, includeContent: true }),
        };
      } catch (caught) {
        if (!(caught instanceof GwenError)) throw caught;
        const loc = readOwnLoc(caught);
        if (loc === undefined) this.error({ message: caught.message, id, cause: caught });
        this.error({ message: caught.message, id, loc, cause: caught });
      }
    },
    api,
  };

  return plugin;
}
