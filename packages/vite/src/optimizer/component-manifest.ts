import type { ComponentEntry } from './types';

/**
 * Build-time registry of all `defineComponent` calls found in the project.
 *
 * Populated during the `buildStart` Vite hook by scanning source files for
 * `defineComponent(...)` calls. The manifest is then used by `AstWalker`
 * and `CodeGenerator` to resolve component metadata at transform time.
 *
 * @example
 * ```ts
 * const manifest = new ComponentManifest()
 * manifest.register({ name: 'Position', typeId: 1, ... })
 * const entry = manifest.get('Position') // ComponentEntry | undefined
 * ```
 */
export class ComponentManifest {
  private readonly _byName = new Map<string, ComponentEntry>();
  private readonly _byId = new Map<number, ComponentEntry>();

  /** Number of registered components. */
  get size(): number {
    return this._byName.size;
  }

  /**
   * Register a component entry.
   * If a component with the same name already exists, it is overwritten
   * (last-write-wins — handles HMR re-scans).
   *
   * @param entry - The component descriptor to register.
   */
  register(entry: ComponentEntry): void {
    this._byName.set(entry.name, entry);
    this._byId.set(entry.typeId, entry);
  }

  /**
   * Look up a component by its string name.
   * Returns `undefined` if not registered.
   *
   * @param name - The component name to look up.
   * @returns The component entry, or `undefined`.
   */
  get(name: string): ComponentEntry | undefined {
    return this._byName.get(name);
  }

  /**
   * Look up a component by its numeric `typeId`.
   * Returns `undefined` if not registered.
   *
   * @param typeId - The numeric type ID to look up.
   * @returns The component entry, or `undefined`.
   */
  getById(typeId: number): ComponentEntry | undefined {
    return this._byId.get(typeId);
  }

  /**
   * Iterate all registered components.
   *
   * @returns An iterator over all component entries.
   */
  entries(): IterableIterator<ComponentEntry> {
    return this._byName.values();
  }

  /** Clear all entries (used between full rebuilds). */
  clear(): void {
    this._byName.clear();
    this._byId.clear();
  }
}
