/**
 * Internal types for the one-pass source transform pipeline.
 * The five structural types are the public contract from `@gwenjs/schema`.
 * Only oxc `Program`, `CallExpression`, `Comment` and `Node` are imported here.
 */

import type { CallExpression, Comment, Node, Program } from "oxc-parser";
import type {
  GwenAstArgument,
  GwenAstNode,
  GwenCallSite,
  GwenImportBinding,
  GwenSourceRange,
} from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";

export type { GwenAstArgument, GwenAstNode, GwenCallSite, GwenImportBinding, GwenSourceRange };

/** One value of {@link ViteErrorCodes}. */
export type ViteErrorCode = (typeof ViteErrorCodes)[keyof typeof ViteErrorCodes];

/**
 * Framework callees the pipeline can resolve.
 * Ticket #66 list, plus `onPreload` and `onTransitionExit`.
 * The frame callbacks and `useService` / `useWasmModule` feed `gwen:hot-path-warn`.
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
  | "useMeshCollider"
  | "defineHooks"
  | "useTween"
  | "onBeforeUpdate"
  | "onAfterUpdate"
  | "onRender"
  | "useService"
  | "useWasmModule";

/** One edit against the original source. Offsets are in that original text. */
export type TransformEdit =
  | { kind: "insert"; at: number; text: string }
  | { kind: "overwrite"; start: number; end: number; text: string }
  | { kind: "remove"; start: number; end: number };

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
  /**
   * True when a directive precedes the first statement, or when a directive is the leading
   * comment of a node that starts at `node.start`. Ancestors are not consulted: a unit checks
   * each enclosing node it cares about.
   */
  isOptedOut(node: { start: number }): boolean;
  /**
   * Records a build warning. It is deduped by code and position, then logged once
   * after every unit ran. A unit failure drops the warnings of that module.
   */
  warn(
    code: ViteErrorCode,
    node: { start: number; end: number },
    what: string,
    options?: { readonly composable?: string; readonly hint?: string | undefined },
  ): void;
}

/** One pure unit. `name` is `gwen:` plus a short id. */
export interface GwenSourceTransform {
  readonly name: `gwen:${string}`;
  run(
    program: Program,
    ctx: TransformContext,
  ): readonly TransformEdit[] | Promise<readonly TransformEdit[]>;
}
