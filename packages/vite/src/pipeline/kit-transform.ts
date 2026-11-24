/**
 * Public context for a kit source transform.
 * Built-in units keep the internal context. A kit unit sees this one.
 */

import type { Node, Program } from "oxc-parser";
import type {
  GwenAstNode,
  GwenErrorCodeString,
  GwenImportBinding,
  GwenSourceRange,
  GwenTransformContext,
  GwenTransformEdit,
} from "@gwenjs/schema";
import { GwenError, type GwenErrorOptions } from "@gwenjs/schema";
import { walk, type WalkerThisContextEnter } from "../oxc/index.js";
import { ViteErrorCodes } from "../error-codes.js";
import { devHint } from "./dev-hint.js";
import { lineColumn } from "./parse.js";
import { isAstNode, type ModuleResolver } from "./resolve-callee.js";

const FRAMEWORK_PREFIXES = [
  "CORE",
  "SCHEMA",
  "KIT",
  "APP",
  "VITE",
  "MATH",
  "RENDERER",
  "CAMERA",
  "PHYSICS2D",
  "PHYSICS3D",
  "CONFORMANCE",
] as const;

/** Errors this module threw. A kit unit's own `GwenError` is not in the set. */
const ownKitErrors = new WeakSet<GwenError>();

/** Edits rejected before they reach MagicString. Wrapped, not passed through. */
const invalidKitEdits = new WeakSet<GwenError>();

interface KitHost {
  readonly id: string;
  readonly code: string;
  readonly program: Program;
  readonly resolver: ModuleResolver;
  /** Built on the first `resolveImport` or `walk`. */
  readonly nodes: () => ReadonlyMap<string, Node>;
  readonly unitName: string;
  readonly emitFile:
    | ((asset: { type: "asset"; fileName: string; source: Uint8Array }) => string)
    | undefined;
  warn(log: {
    message: string;
    code: string;
    id: string;
    loc: { file: string; line: number; column: number };
  }): void;
}

interface RaiseOptions {
  readonly composable?: string;
  readonly hint?: string | undefined;
}

function nodeKey(node: { type: string; start: number; end: number }): string {
  return `${node.type}:${node.start}:${node.end}`;
}

export function indexAstNodes(program: Program): Map<string, Node> {
  const nodes = new Map<string, Node>();
  walk(program, {
    enter(node) {
      nodes.set(nodeKey(node), node);
    },
  });
  return nodes;
}

export function programNode(program: Program): GwenAstNode {
  if (isAstNode(program)) return program;
  return { type: program.type, start: program.start, end: program.end };
}

function isCodeSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  const first = segment.charCodeAt(0);
  if (first < 65 || first > 90) return false;
  for (let index = 1; index < segment.length; index += 1) {
    const code = segment.charCodeAt(index);
    const upper = code >= 65 && code <= 90;
    const digit = code >= 48 && code <= 57;
    const under = code === 95;
    if (!upper && !digit && !under) return false;
  }
  return true;
}

function isKitErrorCode(code: string): boolean {
  const colon = code.indexOf(":");
  if (colon <= 0 || colon !== code.lastIndexOf(":")) return false;
  return isCodeSegment(code.slice(0, colon)) && isCodeSegment(code.slice(colon + 1));
}

function frameworkPrefix(code: string): boolean {
  const colon = code.indexOf(":");
  if (colon <= 0) return false;
  const prefix = code.slice(0, colon);
  for (const reserved of FRAMEWORK_PREFIXES) {
    if (reserved === prefix) return true;
  }
  return false;
}

function acceptableKitCode(code: string): boolean {
  return isKitErrorCode(code) && !frameworkPrefix(code);
}

function grammarOptions(options: RaiseOptions | undefined): GwenErrorOptions {
  const built: GwenErrorOptions = {};
  if (options?.composable !== undefined) built.composable = options.composable;
  if (options?.hint !== undefined) {
    const hint = devHint(options.hint);
    if (hint !== undefined) built.hint = hint;
  }
  return built;
}

function locatedError(
  host: KitHost,
  errorCode: string,
  at: GwenSourceRange,
  what: string,
  options: RaiseOptions | undefined,
): GwenError {
  const place = lineColumn(host.code, at.start);
  const error = new GwenError(errorCode, what, grammarOptions(options));
  return Object.assign(error, {
    loc: { file: host.id, line: place.line, column: place.column - 1 },
  });
}

function rejectForeignCode(unitName: string, code: string): void {
  if (acceptableKitCode(code)) return;
  const error = new GwenError(
    ViteErrorCodes.TRANSFORM_UNSUPPORTED,
    `Transform "${unitName}" raised "${code}", which is not one of its own codes.`,
    { composable: "gwen" },
  );
  ownKitErrors.add(error);
  throw error;
}

export function rethrowKitFailure(unitName: string, id: string, caught: unknown): never {
  if (caught instanceof GwenError) {
    if (ownKitErrors.has(caught)) throw caught;
    if (!invalidKitEdits.has(caught)) {
      if (!acceptableKitCode(caught.code)) rejectForeignCode(unitName, caught.code);
      throw caught;
    }
  }
  throw new GwenError(
    ViteErrorCodes.TRANSFORM_UNIT_FAILED,
    `Transform "${unitName}" failed on ${id}.`,
    { composable: "gwen", cause: caught },
  );
}

export function rethrowUnitFailure(unitName: string, id: string, caught: unknown): never {
  if (caught instanceof GwenError) throw caught;
  throw new GwenError(
    ViteErrorCodes.TRANSFORM_UNIT_FAILED,
    `Transform "${unitName}" failed on ${id}.`,
    { composable: "gwen", cause: caught },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function integerInRange(value: unknown, length: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= length;
}

function rejectEdit(what: string): never {
  const error = new GwenError(ViteErrorCodes.TRANSFORM_UNIT_FAILED, what, { composable: "gwen" });
  invalidKitEdits.add(error);
  throw error;
}

function rejectSpan(
  start: unknown,
  end: unknown,
  length: number,
): { readonly start: number; readonly end: number } {
  if (!integerInRange(start, length) || !integerInRange(end, length)) {
    rejectEdit("edit offsets are out of range.");
  }
  if (start >= end) {
    rejectEdit(start === end ? "edit range is empty." : "edit start is after its end.");
  }
  return { start, end };
}

/** Copy one kit edit, or throw when its kind or offsets are not usable. */
export function toInternalEdit(edit: unknown, length: number): GwenTransformEdit {
  if (!isRecord(edit)) rejectEdit("edit is not an object.");
  const kind = edit["kind"];
  if (kind === "insert") {
    const at = edit["at"];
    const text = edit["text"];
    if (!integerInRange(at, length)) rejectEdit("insert offset is out of range.");
    if (typeof text !== "string") rejectEdit("insert text is not a string.");
    return { kind: "insert", at, text };
  }
  if (kind !== "overwrite" && kind !== "remove") {
    rejectEdit("edit kind is not insert, overwrite, or remove.");
  }
  const span = rejectSpan(edit["start"], edit["end"], length);
  if (kind === "remove") return { kind: "remove", start: span.start, end: span.end };
  const text = edit["text"];
  if (typeof text !== "string") rejectEdit("overwrite text is not a string.");
  return { kind: "overwrite", start: span.start, end: span.end, text };
}

export function createKitContext(host: KitHost): GwenTransformContext {
  return {
    id: host.id,
    code: host.code,
    calls: () => host.resolver.calls(),
    resolveImport(node: GwenAstNode): GwenImportBinding | null {
      const found = host.nodes().get(nodeKey(node));
      if (found === undefined) return null;
      return host.resolver.resolveImport(found);
    },
    walk(visit): void {
      host.nodes();
      walk(host.program, {
        enter(this: WalkerThisContextEnter, node, parent) {
          if (!isAstNode(node)) return;
          const owner = parent !== null && isAstNode(parent) ? parent : null;
          if (visit(node, owner) === "skip") this.skip();
        },
      });
    },
    raise(code: GwenErrorCodeString, at, what, options): never {
      rejectForeignCode(host.unitName, code);
      throw locatedError(host, code, at, what, options);
    },
    warn(code: GwenErrorCodeString, at, what, options): void {
      rejectForeignCode(host.unitName, code);
      const error = locatedError(host, code, at, what, options);
      const place = lineColumn(host.code, at.start);
      host.warn({
        message: error.message,
        code,
        id: host.id,
        loc: { file: host.id, line: place.line, column: place.column - 1 },
      });
    },
    emitAsset(name, source): string {
      if (host.emitFile === undefined) {
        const error = new GwenError(
          ViteErrorCodes.TRANSFORM_UNSUPPORTED,
          "emitAsset is only available in a build.",
          { composable: "gwen" },
        );
        ownKitErrors.add(error);
        throw error;
      }
      host.emitFile({ type: "asset", fileName: name, source });
      return name;
    },
  };
}
