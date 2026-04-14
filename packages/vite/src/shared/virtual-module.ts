/**
 * Creates a virtual module id pair for Vite plugins.
 *
 * Vite resolves virtual modules via a `\0`-prefixed id convention. This helper
 * encapsulates both the public virtual name and the internal resolved id so
 * they are always kept in sync.
 *
 * @param name - The public virtual module name (e.g. `"virtual:gwen/actors"`).
 * @returns An object with `virtual` (the import name) and `resolved` (the `\0`-prefixed id).
 *
 * @example
 * ```ts
 * const { virtual, resolved } = createVirtualModule('virtual:gwen/actors')
 * // virtual  → 'virtual:gwen/actors'
 * // resolved → '\0virtual:gwen/actors'
 * ```
 */
export function createVirtualModule(name: string): { virtual: string; resolved: string } {
  return { virtual: name, resolved: "\0" + name };
}
