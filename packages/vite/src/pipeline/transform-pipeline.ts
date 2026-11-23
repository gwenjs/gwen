/**
 * One AST pass per module. Units share that program and never re-parse.
 * Callees resolve through the import binding, the scope index and auto-imports.
 * `autoImports` is read when a module is transformed.
 * Barrel results arrive later through `followed`; this pass leaves that map empty.
 */

import type { Program } from "oxc-parser";
import type { Plugin } from "vite";
import type { AutoImport } from "@gwenjs/kit";
import { GwenError } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import { applyEdits } from "./apply-edits.js";
import { devHint } from "./dev-hint.js";
import { lineColumn, parseModule, pathWithoutQuery } from "./parse.js";
import { createModuleResolver } from "./resolve-callee.js";
import type {
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

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mts|cts)$/;

interface SourceLoc {
  readonly file: string;
  readonly line: number;
  readonly column: number;
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
  autoImports: readonly AutoImport[],
): TransformContext {
  const followed = new Map<string, GwenImportBinding>();
  const resolver = createModuleResolver({ program, code, id, autoImports, followed });
  return {
    id,
    code,
    comments,
    resolveCallee: resolver.resolveCallee,
    calls: resolver.calls,
    resolveImport: resolver.resolveImport,
    isModuleScopeBinding: resolver.isModuleScopeBinding,
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
  const autoImports = options.autoImports ?? [];
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
        const context = createContext(id, code, parsed.program, parsed.comments, autoImports);
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
