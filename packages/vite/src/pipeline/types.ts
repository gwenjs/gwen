/**
 * Internal types for the one-pass source transform pipeline.
 * Public schema types are a later PR. Only oxc `Program`, `CallExpression`,
 * `Comment` and `Node` are imported here.
 */

import type { CallExpression, Comment, Node, Program } from "oxc-parser";
import { ViteErrorCodes } from "../error-codes.js";

/** One value of {@link ViteErrorCodes}. */
export type ViteErrorCode = (typeof ViteErrorCodes)[keyof typeof ViteErrorCodes];

/**
 * Framework callees the pipeline can resolve.
 * Ticket #66 list, plus `onPreload` and `onTransitionExit`.
 * `onTransitionEnter` is not in this union.
 */
export type GwenCallee =
  | "defineSystem"
  | "onUpdate"
  | "useQuery"
  | "useComponent"
  | "defineScene"
  | "onEnter"
  | "onExit"
  | "onPreload"
  | "onTransitionExit"
  | "defineSceneRouter"
  | "defineActor"
  | "definePrefab"
  | "useActor"
  | "defineLayout"
  | "withAsyncContext"
  | "defineLayers"
  | "useMeshCollider";

/** One edit against the original source. Offsets are in that original text. */
export type TransformEdit =
  | { kind: "insert"; at: number; text: string }
  | { kind: "overwrite"; start: number; end: number; text: string }
  | { kind: "remove"; start: number; end: number };

/** Offsets in the original source. */
export interface GwenSourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * One AST node in the call-site contract.
 * vite-internal projection: type, start and end only; the full-node contract is decided with the schema types in P-66-6.
 * An oxc node has no string index signature, so `resolveImport` takes `Node`.
 */
export interface GwenAstNode extends GwenSourceRange {
  readonly type: string;
  readonly [field: string]: unknown;
}

/** Origin of an import binding: source and imported name; a default import uses `default`. */
export interface GwenImportBinding {
  readonly source: string;
  readonly imported: string;
}

/** One argument of a call. Anything except a string or number literal is `other`. */
export type GwenAstArgument =
  | ({ readonly kind: "string"; readonly value: string } & GwenSourceRange)
  | ({ readonly kind: "number"; readonly value: number } & GwenSourceRange)
  | ({ readonly kind: "other"; readonly node: GwenAstNode } & GwenSourceRange);

/**
 * One call in source order. `binding` is null when the callee is unresolved.
 * vite-internal projection: type, start and end only; the full-node contract is decided with the schema types in P-66-6.
 */
export interface GwenCallSite extends GwenSourceRange {
  readonly binding: GwenImportBinding | null;
  readonly arguments: readonly GwenAstArgument[];
  readonly node: GwenAstNode;
}

/**
 * Per-module context shared by every unit.
 * `hint` is `string | undefined` so a prod ternary typechecks
 * (`packages/schema/src/errors.ts:22-28`).
 */
export interface TransformContext {
  readonly id: string;
  readonly code: string;
  readonly comments: readonly Comment[];
  resolveCallee(node: CallExpression): GwenCallee | null;
  calls(): readonly GwenCallSite[];
  resolveImport(node: Node): GwenImportBinding | null;
  isModuleScopeBinding(name: string, at: number): boolean;
  emitFile?(asset: { type: "asset"; fileName: string; source: Uint8Array }): string;
  raise(
    code: ViteErrorCode,
    node: { start: number; end: number },
    what: string,
    hint?: string | undefined,
    cause?: unknown,
  ): never;
}

/** One pure unit. `name` is `gwen:` plus a short id. */
export interface GwenSourceTransform {
  readonly name: `gwen:${string}`;
  run(
    program: Program,
    ctx: TransformContext,
  ): readonly TransformEdit[] | Promise<readonly TransformEdit[]>;
}
