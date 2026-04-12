/**
 * @file RFC-005 — Composable context system for @gwenjs/core
 *
 * Provides `engineContext` (backed by unctx) and the `useEngine()` composable.
 * The engine wraps its entire frame loop and plugin setup calls in this context,
 * making composables available without explicit parameter passing.
 */

import { createContext } from "unctx";
import type { GwenEngine } from "./gwen-engine";

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * The global engine context backed by unctx.
 *
 * Uses a simple synchronous (non-async) context for browser compatibility.
 * Active during:
 * - `engine.run(fn)` — explicit context scoping
 * - `engine.activate()` / `engine.deactivate()` — manual lifecycle
 * - All 8 frame phases inside `_runFrame()` (onBeforeUpdate, onUpdate, onAfterUpdate, onRender…)
 * - Plugin `setup()` calls inside `engine.use()`
 *
 * @internal — import `useEngine()` instead for public usage
 */
export const engineContext = createContext<GwenEngine>({
  asyncContext: false,
});

// ─── Error codes ─────────────────────────────────────────────────────────────

/**
 * Structured error codes for {@link GwenContextError}.
 *
 * - `OUTSIDE_ENGINE` — composable called outside any active engine context
 *   (e.g. at module top-level, in a plain DOM callback, or after an `await`
 *   without context propagation).
 * - `ACTOR_SETUP_ONLY` — composable is only valid during an actor factory phase.
 */
export type GwenContextErrorCode = "OUTSIDE_ENGINE" | "ACTOR_SETUP_ONLY";

// ─── GwenContextError ────────────────────────────────────────────────────────

/**
 * Thrown when a GWEN composable is called outside an active engine context.
 *
 * Check {@link GwenContextError.code} to distinguish the root cause, and read
 * the message for a step-by-step fix.
 */
export class GwenContextError extends Error {
  /**
   * Structured code identifying the root cause.
   * @see {@link GwenContextErrorCode}
   */
  readonly code: GwenContextErrorCode;

  constructor(message: string, code: GwenContextErrorCode = "OUTSIDE_ENGINE") {
    super(message);
    this.name = "GwenContextError";
    this.code = code;
  }
}

const OUTSIDE_ENGINE_MESSAGE = `\
[GWEN] useEngine() was called outside an active engine context.

Common causes and fixes:

1. Called at module top-level or in a plain callback
   → Wrap with engine.run():
     engine.run(() => { useEngine() })

2. Called after an \`await\` inside an async lifecycle callback (context lost)
   → In onEnter / onExit: ensure @gwenjs/vite is configured in vite.config.ts.
     The async context transform handles this automatically.

   → In onStart or a custom async callback: use withAsyncContext():
     import { withAsyncContext } from '@gwenjs/core'
     onStart(withAsyncContext(async () => {
       await doSomething()
       useHTML()  // ✅ context restored
     }))

   → Or capture the composable before the first await (preferred for actors):
     onStart(async () => {
       const html = useHTML()  // ✅ captured before await
       await doSomething()
       html.mount()
     })`;

// ─── useEngine() ─────────────────────────────────────────────────────────────

/**
 * Returns the currently active {@link GwenEngine} instance.
 *
 * Must be called within an active engine context:
 * - Inside `defineSystem()` factory or any of its frame hooks
 * - Inside `defineScene()` factory
 * - Inside `engine.run(fn)`
 * - Inside `onEnter()` or `onExit()` (sync or async — handled by Vite transform)
 * - Inside `withAsyncContext()` wrapper
 *
 * @throws {GwenContextError} When called outside any engine context. The error
 *   message explains the most common fixes, including the async context pattern.
 *
 * @example Inside engine.run():
 * ```typescript
 * const instance = engine.run(() => useEngine()) // instance === engine ✓
 * ```
 *
 * @example Inside defineSystem():
 * ```typescript
 * const mySystem = defineSystem(() => {
 *   const engine = useEngine()
 *   onUpdate((dt) => { /* engine available here too *\/ })
 * })
 * ```
 *
 * @example Inside async onEnter (requires \@gwenjs/vite):
 * ```typescript
 * const Scene = defineScene('game', () => {
 *   onEnter(async () => {
 *     await loadAssets()
 *     const engine = useEngine() // ✅ context restored by Vite transform
 *   })
 * })
 * ```
 */
export function useEngine(): GwenEngine {
  const engine = engineContext.tryUse();
  if (!engine) {
    throw new GwenContextError(OUTSIDE_ENGINE_MESSAGE, "OUTSIDE_ENGINE");
  }
  return engine;
}
