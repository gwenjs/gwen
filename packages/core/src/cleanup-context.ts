/**
 * Module-level cleanup context system for managing lifecycle callbacks.
 *
 * Provides a stack-based cleanup context that collects callbacks registered
 * via {@link onCleanup}, supporting nested contexts for complex cleanup scenarios.
 * Used internally by the actor system and available for manual lifecycle management.
 *
 * @module
 */

/**
 * Module-level stack of cleanup callback arrays.
 * Supports nested cleanup contexts via push/pop operations.
 *
 * @internal
 */
const _cleanupStack: Array<(() => void)[]> = []

/**
 * Wraps a function in a cleanup context, collecting all cleanup callbacks.
 *
 * Establishes a new cleanup context before executing the function, pushes it to
 * the module-level stack, and pops it upon completion (even if the function throws).
 * All callbacks registered via {@link onCleanup} or {@link tryOnCleanup} during
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
  const fns: (() => void)[] = []
  _cleanupStack.push(fns)
  let result: T
  try {
    result = fn()
  } finally {
    _cleanupStack.pop()
  }
  return [result, () => { for (const f of fns) f() }]
}

/**
 * Internal helper that registers a cleanup callback if a cleanup context is active.
 *
 * Pushes the callback to the topmost cleanup array on the module stack.
 * Silently no-ops if no cleanup context is active (stack is empty).
 *
 * @internal
 *
 * @param fn - Cleanup callback to register
 */
export function tryOnCleanup(fn: () => void): void {
  const top = _cleanupStack[_cleanupStack.length - 1]
  if (top) {
    top.push(fn)
  }
}

/**
 * Registers a cleanup callback in the currently active lifecycle context.
 *
 * Works inside `defineActor()` factory functions, plugin `setup()` callbacks,
 * and any code wrapped by {@link withCleanup}. Silently no-ops outside of a
 * cleanup context — safe to call unconditionally.
 *
 * Callbacks are executed in reverse order (LIFO) when the context is disposed,
 * ensuring proper cleanup of nested resources.
 *
 * @param fn - Callback to invoke when the active lifecycle ends (actor despawn,
 *   plugin teardown, or manual {@link withCleanup} dispose).
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
 * @see {@link withCleanup} — establishes a cleanup context
 * @since 1.0.0
 */
export function onCleanup(fn: () => void): void {
  tryOnCleanup(fn)
}
