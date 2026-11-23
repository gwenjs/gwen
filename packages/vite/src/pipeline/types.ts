/**
 * Internal types for the one-pass source transform pipeline.
 * Public schema types are a later PR. Only oxc `Program`, `CallExpression`
 * and `Comment` are imported here.
 */

import type { CallExpression, Comment, Program } from "oxc-parser";
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
  isModuleScopeBinding(name: string, at: number): boolean;
  emitFile?(asset: { type: "asset"; name: string; source: Uint8Array }): string;
  raise(
    code: ViteErrorCode,
    node: { start: number; end: number },
    what: string,
    hint?: string | undefined,
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
