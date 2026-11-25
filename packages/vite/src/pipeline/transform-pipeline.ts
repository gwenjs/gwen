/**
 * One AST pass per module. Units share that program and never re-parse.
 * Callees resolve through the import binding, the scope index and auto-imports.
 * `autoImports` is read when a module is transformed.
 * Project barrels are followed before units run. The cache lives on this plugin.
 */

import type { Program } from "oxc-parser";
import type { Alias, Plugin } from "vite";
import type { AutoImport } from "@gwenjs/kit";
import { GwenError, type GwenSourceTransform as KitSourceTransform } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import { applyEdits } from "./apply-edits.js";
import { followBarrels, type Barrels } from "./barrel.js";
import { devHint } from "./dev-hint.js";
import { buildImportTable } from "./import-table.js";
import {
  createKitContext,
  indexAstNodes,
  programNode,
  rethrowKitFailure,
  rethrowUnitFailure,
  toInternalEdit,
} from "./kit-transform.js";
import { createOptOut } from "./opt-out.js";
import { isScriptModule, lineColumn, parseModule } from "./parse.js";
import { createModuleResolver, type ModuleResolver } from "./resolve-callee.js";
import type {
  GwenImportBinding,
  GwenSourceTransform,
  TransformContext,
  TransformEdit,
} from "./types.js";

/** In-plugin handle. `register` and `registerKit` are refused after `buildStart`. */
export interface GwenTransformPipelineApi {
  register(t: GwenSourceTransform): void;
  registerKit(t: KitSourceTransform): void;
  readonly names: readonly string[];
}

interface SourceLoc {
  readonly file: string;
  readonly line: number;
  readonly column: number;
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

/** One recorded warning, in the shape of the kit host log. */
interface PendingWarning {
  readonly message: string;
  readonly code: string;
  readonly id: string;
  readonly loc: SourceLoc;
}

function acceptsModule(id: string): boolean {
  if (id.startsWith("\0")) return false;
  if (id.includes("/node_modules/")) return false;
  return isScriptModule(id);
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
  comments: TransformContext["comments"],
  resolver: ModuleResolver,
  emitFile: TransformContext["emitFile"],
  program: Program,
  pending: PendingWarning[],
): TransformContext {
  const isOptedOut = createOptOut(code, comments, program);
  const warned = new Set<string>();
  const context: TransformContext = {
    id,
    code,
    comments,
    resolveCallee: resolver.resolveCallee,
    calls: resolver.calls,
    resolveImport: resolver.resolveImport,
    isModuleScopeBinding: resolver.isModuleScopeBinding,
    isOptedOut,
    warn(errorCode, node, what, options): void {
      const key = `${errorCode}:${node.start}`;
      if (warned.has(key)) return;
      warned.add(key);
      const place = lineColumn(code, node.start);
      const hint = options?.hint === undefined ? undefined : devHint(options.hint);
      const composable = options?.composable;
      const error = new GwenError(
        errorCode,
        what,
        composable === undefined ? { hint } : { composable, hint },
      );
      pending.push({
        message: error.message,
        code: errorCode,
        id,
        loc: { file: id, line: place.line, column: place.column - 1 },
      });
    },
    raise(errorCode, node, what, hint, cause): never {
      const place = lineColumn(code, node.start);
      const hintText = hint === undefined ? undefined : devHint(hint);
      const error = new GwenError(errorCode, what, {
        composable: "gwen",
        hint: hintText,
        cause,
      });
      // Vite's `generateCodeFrame` and `originalPositionFor` take a 0-based column.
      throw Object.assign(error, {
        loc: { file: id, line: place.line, column: place.column - 1 },
      });
    },
  };
  if (emitFile === undefined) return context;
  return { ...context, emitFile };
}

export function createTransformPipeline(options: {
  units: GwenSourceTransform[];
  autoImports?: readonly AutoImport[];
}): Plugin & { api: GwenTransformPipelineApi } {
  const autoImports = options.autoImports ?? [];
  const builtIns = [...options.units];
  const kitUnits: KitSourceTransform[] = [];
  const registered: GwenSourceTransform[] = [];
  let ordered: readonly { readonly name: string }[] = builtIns;
  let frozenBuiltIns: readonly GwenSourceTransform[] = builtIns;
  let frozenKit: readonly KitSourceTransform[] = [];
  let frozenRegistered: readonly GwenSourceTransform[] = [];
  let frozen = false;
  let projectRoot = "";
  let projectAliases: readonly Alias[] = [];
  let command = "serve";
  const barrelCache = new Map<string, Barrels>();

  function liveNames(): readonly { readonly name: string }[] {
    return [...builtIns, ...kitUnits, ...registered];
  }

  function currentNames(): readonly { readonly name: string }[] {
    if (frozen) return ordered;
    return liveNames();
  }

  function findNamed(name: string): { readonly name: string } | undefined {
    for (const unit of builtIns) {
      if (unit.name === name) return unit;
    }
    for (const unit of kitUnits) {
      if (unit.name === name) return unit;
    }
    for (const unit of registered) {
      if (unit.name === name) return unit;
    }
    return undefined;
  }

  function refuseFrozen(): void {
    if (!frozen) return;
    throw new GwenError(
      ViteErrorCodes.TRANSFORM_UNSUPPORTED,
      "register() was called after buildStart.",
      { composable: "gwen" },
    );
  }

  function refuseDuplicate(
    name: string,
    seen: { readonly name: string } | undefined,
    unit: object,
  ): void {
    if (seen === undefined) return;
    if (seen === unit) return;
    throw new GwenError(
      ViteErrorCodes.TRANSFORM_UNSUPPORTED,
      `register() was called with a different unit named ${name}.`,
      { composable: "gwen" },
    );
  }

  const api: GwenTransformPipelineApi = {
    register(unit): void {
      refuseFrozen();
      const seen = findNamed(unit.name);
      refuseDuplicate(unit.name, seen, unit);
      if (seen === unit) return;
      registered.push(unit);
    },
    registerKit(transform): void {
      refuseFrozen();
      const seen = findNamed(transform.name);
      refuseDuplicate(transform.name, seen, transform);
      if (seen === transform) return;
      kitUnits.push(transform);
    },
    get names(): readonly string[] {
      return currentNames().map((unit) => unit.name);
    },
  };

  const plugin: Plugin & { api: GwenTransformPipelineApi } = {
    name: "gwen:transform-pipeline",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
      projectAliases = config.resolve.alias;
      command = config.command;
    },
    buildStart() {
      frozenBuiltIns = [...builtIns];
      frozenKit = [...kitUnits];
      frozenRegistered = [...registered];
      ordered = [...frozenBuiltIns, ...frozenKit, ...frozenRegistered];
      frozen = true;
    },
    async transform(code, id) {
      if (!acceptsModule(id)) return null;
      try {
        const parsed = parseModule(id, code);
        const units = currentNames();
        const followed =
          units.length === 0
            ? new Map<string, GwenImportBinding>()
            : await followBarrels(buildImportTable(parsed.program), {
                importer: id,
                root: projectRoot,
                aliases: projectAliases,
                cache: barrelCache,
                resolve: (specifier, importer) => this.resolve(specifier, importer),
              });
        const emitFile =
          command === "build"
            ? (asset: { type: "asset"; fileName: string; source: Uint8Array }): string =>
                this.emitFile({ type: "asset", fileName: asset.fileName, source: asset.source })
            : undefined;
        const activeBuiltIns = frozen ? frozenBuiltIns : builtIns;
        const activeKit = frozen ? frozenKit : kitUnits;
        const activeRegistered = frozen ? frozenRegistered : registered;
        const resolver = createModuleResolver({
          program: parsed.program,
          code,
          autoImports,
          followed,
        });
        const pending: PendingWarning[] = [];
        const context = createContext(
          id,
          code,
          parsed.comments,
          resolver,
          emitFile,
          parsed.program,
          pending,
        );
        const tagged: Array<TransformEdit & { unit: string }> = [];
        for (const unit of activeBuiltIns) {
          let produced: readonly TransformEdit[];
          try {
            produced = await unit.run(parsed.program, context);
          } catch (caught) {
            rethrowUnitFailure(unit.name, id, caught);
          }
          for (const edit of produced) tagged.push(tagEdit(edit, unit.name));
        }
        if (activeKit.length > 0) {
          const ast = programNode(parsed.program);
          let nodes: ReturnType<typeof indexAstNodes> | undefined;
          const nodeIndex = (): ReturnType<typeof indexAstNodes> => {
            const cached = nodes;
            if (cached !== undefined) return cached;
            const built = indexAstNodes(parsed.program);
            nodes = built;
            return built;
          };
          for (const kit of activeKit) {
            const sourceText = code;
            const publicContext = createKitContext({
              id,
              code: sourceText,
              program: parsed.program,
              resolver,
              nodes: nodeIndex,
              unitName: kit.name,
              emitFile,
              warn: (log) => {
                this.warn(log);
              },
            });
            let produced: readonly ReturnType<typeof toInternalEdit>[];
            try {
              const edits = await kit.run(ast, publicContext);
              const copied: ReturnType<typeof toInternalEdit>[] = [];
              for (const edit of edits) copied.push(toInternalEdit(edit, sourceText.length));
              produced = copied;
            } catch (caught) {
              rethrowKitFailure(kit.name, id, caught);
            }
            for (const edit of produced) tagged.push(tagEdit(edit, kit.name));
          }
        }
        for (const unit of activeRegistered) {
          let produced: readonly TransformEdit[];
          try {
            produced = await unit.run(parsed.program, context);
          } catch (caught) {
            rethrowUnitFailure(unit.name, id, caught);
          }
          for (const edit of produced) tagged.push(tagEdit(edit, unit.name));
        }
        for (const log of pending) this.warn(log);
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
    watchChange(id): void {
      if (!barrelCache.has(id)) return;
      barrelCache.clear();
    },
    api,
  };

  return plugin;
}
