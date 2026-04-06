/**
 * @file RFC-005 — Composable context system for @gwenjs/core
 *
 * Provides `engineContext` (backed by unctx) and the `useEngine()` composable.
 * The engine wraps its entire frame loop and plugin setup calls in this context,
 * making composables available without explicit parameter passing.
 */

import { createContext } from 'unctx';
import type { GwenEngine } from './engine/gwen-engine.js';

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

// ─── useEngine() ─────────────────────────────────────────────────────────────

/**
 * Error thrown when a composable is used outside of an active engine context.
 *
 * @example
 * ```typescript
 * try {
 *   const engine = useEngine()
 * } catch (e) {
 *   if (e instanceof GwenContextError) {
 *     console.error('Composable called outside engine context')
 *   }
 * }
 * ```
 */
export class GwenContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GwenContextError';
  }
}

/**
 * Returns the currently active {@link GwenEngine} instance.
 *
 * Must be called within an active engine context:
 * - Inside a system defined with `defineSystem()`
 * - Inside `engine.run(fn)`
 * - During a plugin lifecycle hook (`setup`, `onUpdate`, `onRender`, `onBeforeUpdate`, `onAfterUpdate`)
 *
 * @returns The active {@link GwenEngine} instance
 * @throws {GwenContextError} If called outside any active engine context
 *
 * @example Inside engine.run():
 * ```typescript
 * const engine = await createEngine()
 * const instance = engine.run(() => useEngine())
 * // instance === engine ✓
 * ```
 *
 * @example Inside defineSystem():
 * ```typescript
 * const mySystem = defineSystem(() => {
 *   const engine = useEngine()
 *   onUpdate((dt) => {
 *     // engine is available here too
 *   })
 * })
 * ```
 */
export function useEngine(): GwenEngine {
  const engine = engineContext.tryUse();
  if (!engine) {
    throw new GwenContextError(
      '[GWEN] useEngine() was called outside of an engine context.\n' +
        'Make sure you are calling it inside defineSystem(), engine.run(), ' +
        'or a plugin lifecycle hook (setup, onUpdate, onRender, etc.).',
    );
  }
  return engine;
}
