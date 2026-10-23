/**
 * @file Context and composable errors.
 *
 * Canonical home of `GwenContextError` and `GwenComposableError`.
 * `@gwenjs/core` re-exports the same class objects.
 */

import { GwenError } from "@gwenjs/schema";

/**
 * Structured error codes for {@link GwenContextError}.
 *
 * - `CORE:OUTSIDE_ENGINE_CONTEXT` — composable called outside any active engine context
 *   (at module top-level, in a plain DOM callback, or after an `await`
 *   without context propagation).
 * - `ACTOR_SETUP_ONLY` — composable is only valid during an actor factory phase.
 */
export const GwenContextErrorCodes = {
  OUTSIDE_ENGINE_CONTEXT: "CORE:OUTSIDE_ENGINE_CONTEXT",
  ACTOR_SETUP_ONLY: "ACTOR_SETUP_ONLY",
} as const;

export type GwenContextErrorCode =
  (typeof GwenContextErrorCodes)[keyof typeof GwenContextErrorCodes];

/**
 * Thrown when a GWEN composable is called outside an active engine context.
 *
 * Check {@link GwenContextError.code} to distinguish the root cause, and read
 * the message for a step-by-step fix.
 */
export class GwenContextError extends GwenError {
  /**
   * Structured code identifying the root cause.
   * @see {@link GwenContextErrorCode}
   */
  override readonly code: GwenContextErrorCode;

  constructor(
    message: string,
    code: GwenContextErrorCode = GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT,
  ) {
    super(code, message);
    this.name = "GwenContextError";
    this.code = code;
  }
}

/**
 * Thrown when a composable is called outside its valid context.
 *
 * All GWEN composables (`useEntityId`, `useComponent`, `onStart`, `onDestroy`,
 * `onEvent`, etc.) throw this error when invoked at the wrong lifecycle phase.
 * Catch it with `instanceof GwenComposableError` to handle composable misuse
 * independently from engine or actor errors.
 *
 * @example
 * ```ts
 * try {
 *   useEntityId(); // called outside a factory
 * } catch (e) {
 *   if (e instanceof GwenComposableError) {
 *     console.error('Composable misuse:', e.code, e.message);
 *   }
 * }
 * ```
 */
export class GwenComposableError extends GwenError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "GwenComposableError";
  }
}
