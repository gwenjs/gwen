/**
 * Public build-transform contract.
 *
 * Types only. A module registers one with `kit.addSourceTransform` and never
 * imports the Vite package. Offsets are indexes into the original source.
 *
 * @module
 */

/** Offsets in the original source text. */
export interface GwenSourceRange {
  readonly start: number;
  readonly end: number;
}

/**
 * One node handed to a transform.
 * `type`, `start` and `end` are always set. Every other field is `unknown`.
 */
export interface GwenAstNode extends GwenSourceRange {
  readonly type: string;
  readonly [field: string]: unknown;
}

/**
 * Where an imported name comes from, after a barrel is followed to its origin.
 * A default import uses `imported: "default"`.
 */
export interface GwenImportBinding {
  readonly source: string;
  readonly imported: string;
}

/** One call argument. Anything except a string or number literal is `other`. */
export type GwenAstArgument =
  | ({ readonly kind: "string"; readonly value: string } & GwenSourceRange)
  | ({ readonly kind: "number"; readonly value: number } & GwenSourceRange)
  | ({ readonly kind: "other"; readonly node: GwenAstNode } & GwenSourceRange);

/**
 * One call, in source order. `binding` is null when the callee is not an import.
 * A transform must not mutate the call site, its arguments, or `node`.
 */
export interface GwenCallSite extends GwenSourceRange {
  readonly binding: GwenImportBinding | null;
  readonly arguments: readonly GwenAstArgument[];
  readonly node: GwenAstNode;
}

/** One edit against the original source. Offsets are in that original text. */
export type GwenTransformEdit =
  | { readonly kind: "insert"; readonly at: number; readonly text: string }
  | {
      readonly kind: "overwrite";
      readonly start: number;
      readonly end: number;
      readonly text: string;
    }
  | { readonly kind: "remove"; readonly start: number; readonly end: number };

/** `NAMESPACE:REASON`. The pipeline rejects a framework prefix. */
export type GwenErrorCodeString = `${string}:${string}`;

/**
 * What a transform may do with one module.
 * `calls` is computed once. `raise` stops the build. `warn` does not.
 */
export interface GwenTransformContext {
  readonly id: string;
  readonly code: string;
  calls(): readonly GwenCallSite[];
  resolveImport(node: GwenAstNode): GwenImportBinding | null;
  walk(visit: (node: GwenAstNode, parent: GwenAstNode | null) => void | "skip"): void;
  raise(
    code: GwenErrorCodeString,
    at: GwenSourceRange,
    what: string,
    options?: { readonly composable?: string; readonly hint?: string | undefined },
  ): never;
  warn(
    code: GwenErrorCodeString,
    at: GwenSourceRange,
    what: string,
    options?: { readonly composable?: string; readonly hint?: string | undefined },
  ): void;
  emitAsset(name: string, source: Uint8Array): string;
}

/**
 * One build transform.
 * `name` is `<namespace>:<transform>` in lower case. The `gwen:` namespace is reserved.
 * `run` must not mutate the program, the call sites, or any node. Edits are the only output.
 */
export interface GwenSourceTransform {
  readonly name: string;
  /**
   * Read the original program and return edits.
   * Do not mutate the program, the call sites, or any node.
   */
  run(
    program: GwenAstNode,
    ctx: GwenTransformContext,
  ): readonly GwenTransformEdit[] | Promise<readonly GwenTransformEdit[]>;
}
