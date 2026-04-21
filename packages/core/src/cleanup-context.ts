/**
 * Module-level cleanup context system for managing lifecycle callbacks.
 *
 * Provides a stack-based cleanup context that collects callbacks registered
 * via {@link onCleanup}, supporting nested contexts for complex cleanup scenarios.
 * Used internally by the actor system and available for manual lifecycle management.
 *
 * Phase 5 (GwenScope unified): onCleanup() delegates exclusively to GwenScope.current().
 * The `withCleanup()` function provides legacy support for non-scoped cleanup contexts
 * via a fallback mechanism.
 *
 * @module
 */

import { GwenScope } from "./context/scope.js";

/**
 * Module-level stack of cleanup callback arrays.
 * Supports nested cleanup contexts via push/pop operations.
 *
 * @internal
 */
const _cleanupStack: Array<(() => void)[]> = [];

/**
 * Wraps a function in a cleanup context, collecting all cleanup callbacks.
 *
 * Establishes a new cleanup context before executing the function, pushes it to
 * the module-level stack, and pops it upon completion (even if the function throws).
 * All callbacks registered via {@link onCleanup} or {@link onCleanupIfActive} during
 * execution are collected and returned as a dispose function.
 *
 * @internal
 *
 * @param fn - Function to execute within the cleanup context
 * @returns Tuple of [result, dispose] where result is the function's return value
 *   and dispose is a function that executes all collected cleanup callbacks in
 *   reverse order (LIFO).
 *
 * @example
 * ```typescript
 * const [actor, dispose] = withCleanup(() => {
 *   const timer = setInterval(() => tick(), 1000)
 *   onCleanup(() => clearInterval(timer))
 *   return { id: 123 }
 * })
 * // actor is { id: 123 }
 * // Later: dispose() clears the interval
 * ```
 */
export function withCleanup<T>(fn: () => T): [result: T, dispose: () => void] {
  const fns: (() => void)[] = [];
  _cleanupStack.push(fns);
  let result: T;
  try {
    result = fn();
  } finally {
    _cleanupStack.pop();
  }
  return [
    result,
    () => {
      for (const f of fns) f();
    },
  ];
}

/**
 * Registers a cleanup callback only if a cleanup context is currently active.
 *
 * Unlike {@link onCleanup}, this function does **not** throw when called outside
 * a context — it silently skips the registration. This is intentional: it is
 * designed for composables that are valid both inside and outside lifecycle
 * contexts (e.g. utility helpers that optionally participate in actor cleanup).
 *
 * If you always expect a context to be active, use {@link onCleanup} instead —
 * it will throw with a clear error if the context is missing.
 *
 * @param fn - Callback to register if a context is active.
 *
 * @example
 * ```ts
 * // Safe to call anywhere — no-op if no context:
 * onCleanupIfActive(() => socket.close());
 *
 * // Prefer onCleanup() if a context is always required:
 * onCleanup(() => socket.close()); // throws if no context
 * ```
 *
 * @see {@link onCleanup} — strict variant that requires an active context
 * @see {@link withCleanup} — establish a cleanup context manually
 */
export function onCleanupIfActive(fn: () => void): void {
  // Try GwenScope first
  const scope = GwenScope.current();
  if (scope) {
    scope.onCleanup(fn);
    return;
  }

  // Fallback to legacy _cleanupStack for withCleanup() contexts
  const top = _cleanupStack[_cleanupStack.length - 1];
  if (top) {
    top.push(fn);
  }
}

/**
 * Registers a cleanup callback in the currently active lifecycle context.
 *
 * **Strict variant** — throws {@link Error} when called outside an active
 * cleanup context. Use this in composables that always require a lifecycle
 * context (actor factory, plugin `setup()`, `withCleanup()`). For composables
 * that work both inside and outside a context, use {@link onCleanupIfActive}
 * instead.
 *
 * Phase 5: When a {@link GwenScope} is active (via `scope.run()`), the callback
 * is registered on the scope. Falls back to the legacy `_cleanupStack` mechanism
 * for `withCleanup()` contexts outside any GwenScope.
 *
 * Callbacks are executed in LIFO order when the context is disposed.
 *
 * @param fn - Callback to invoke when the active lifecycle ends (actor despawn,
 *   plugin teardown, or manual {@link withCleanup} dispose).
 *
 * @throws {Error} If called outside an active cleanup context.
 *
 * @example Inside a defineActor factory:
 * ```typescript
 * import { defineActor, onCleanup } from '@gwenjs/core'
 *
 * const MyActor = defineActor(MyPrefab, () => {
 *   const timer = setInterval(() => doTick(), 1000)
 *   onCleanup(() => clearInterval(timer))
 *   return {}
 * })
 * ```
 *
 * @example Writing a reusable composable:
 * ```typescript
 * function useWindowResize(fn: (e: UIEvent) => void) {
 *   window.addEventListener('resize', fn)
 *   onCleanup(() => window.removeEventListener('resize', fn))
 * }
 * ```
 *
 * @example Standalone cleanup context:
 * ```typescript
 * const [data, dispose] = withCleanup(() => {
 *   const resource = acquireResource()
 *   onCleanup(() => resource.release())
 *   return resource.data
 * })
 * // Use data...
 * dispose() // Runs cleanup
 * ```
 *
 * @see {@link onCleanupIfActive} — lenient variant, no-ops outside context
 * @see {@link withCleanup} — establishes a cleanup context
 * @since 1.0.0
 */
export function onCleanup(fn: () => void): void {
  // Phase 5: Prefer active GwenScope
  const scope = GwenScope.current();
  if (scope) {
    scope.onCleanup(fn);
    return;
  }

  // Fallback: legacy _cleanupStack for withCleanup() contexts
  const top = _cleanupStack[_cleanupStack.length - 1];
  if (!top) {
    throw new Error(
      "[GWEN] onCleanup() called outside an active cleanup context. " +
        "Call it inside a defineActor() factory, plugin setup(), or withCleanup(). " +
        "For composables that work both inside and outside a context, use onCleanupIfActive() instead.",
    );
  }
  top.push(fn);
}
