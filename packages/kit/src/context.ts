/**
 * @file Public API for accessing the current scope.
 *
 * Plugin authors use this function to access the current scope
 * from plugin setup, factories, and engine.run().
 *
 * @module
 */

import type { IGwenScope } from "@gwenjs/schema";

import { GwenScope } from "@gwenjs/core/internal";

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
 * import { useCurrentScope } from '@gwenjs/kit'
 *
 * export const MyPlugin = definePlugin({
 *   setup(engine) {
 *     const scope = useCurrentScope()
 *     console.log(scope?.meta.type) // 'plugin'
 *   }
 * })
 * ```
 */
export function useCurrentScope(): IGwenScope | null {
  return GwenScope.current();
}
