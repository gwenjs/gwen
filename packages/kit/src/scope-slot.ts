/**
 * @file Module slot for the active {@link IGwenScope}.
 *
 * One module binding, no `globalThis`. Core's `GwenScope` writes it.
 * Plugin authors read it through `getCurrentScope()`.
 */

import type { IGwenScope } from "@gwenjs/schema";

let current: IGwenScope | null = null;

/**
 * Returns the currently active scope, or null if outside any context.
 *
 * Valid inside:
 * - Plugin `setup()` functions
 * - System factories
 * - Actor factories
 * - Scene factories
 * - Any code executed via `engine.run()`
 *
 * @example
 * ```ts
 * import { getCurrentScope } from '@gwenjs/kit'
 *
 * export const MyPlugin = definePlugin({
 *   setup(engine) {
 *     const scope = getCurrentScope()
 *     console.log(scope?.meta.type) // 'plugin'
 *   }
 * })
 * ```
 */
export function getCurrentScope(): IGwenScope | null {
  return current;
}

/** @internal Engine use only (core's GwenScope). */
export function _setCurrentScope(scope: IGwenScope | null): void {
  current = scope;
}
