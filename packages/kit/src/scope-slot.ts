/**
 * @file Module slot for the active {@link IGwenScope}.
 *
 * One module binding, no `globalThis`. Core's `GwenScope` writes it.
 * Plugin authors read it through `useCurrentScope()`.
 */

import type { IGwenScope } from "@gwenjs/schema";

let current: IGwenScope | null = null;

/** The scope `GwenScope.run` activated, or null outside any run. */
export function getCurrentScope(): IGwenScope | null {
  return current;
}

/** @internal Engine use only (core's GwenScope). */
export function _setCurrentScope(scope: IGwenScope | null): void {
  current = scope;
}
