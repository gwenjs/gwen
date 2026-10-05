/**
 * @file Public API for accessing and creating scopes.
 *
 * Plugin authors use these functions to access the current scope
 * and create child scopes.
 *
 * @module
 */

import type { IGwenScope, GwenScopeMeta } from "@gwenjs/schema";
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

/**
 * Creates a child scope of the currently active scope.
 * Automatically registered as a child — disposed when the parent is disposed.
 *
 * Throws if called outside any active scope context.
 *
 * @example
 * ```ts
 * import { createChildScope, useCurrentScope } from '@gwenjs/kit'
 *
 * export const MyPlugin = definePlugin({
 *   setup(engine) {
 *     const parentScope = useCurrentScope()!
 *     const childScope = createChildScope(engine, {
 *       type: 'plugin',
 *       id: 'my-child-plugin',
 *       name: 'Child Plugin'
 *     })
 *     // childScope will be automatically disposed when parentScope is disposed
 *   }
 * })
 * ```
 */
export function createChildScope(engine: any, meta: GwenScopeMeta): IGwenScope {
  const parent = GwenScope.current();
  if (!parent) {
    throw new Error(
      "createChildScope() called outside an active scope context. " +
        "This function is only valid inside plugin setup, system factories, actor factories, scene factories, or engine.run().",
    );
  }
  return new GwenScope(engine, meta, parent);
}
