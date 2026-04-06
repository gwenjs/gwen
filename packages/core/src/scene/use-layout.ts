/**
 * @file `useLayout()` — composable for loading and disposing layout instances.
 *
 * A layout is loaded by executing its factory function inside both the engine context
 * and a layout context (`_withLayoutContext`). The resulting entity IDs are stored so
 * `dispose()` can call `bulk_destroy` in a single WASM call.
 *
 * @example
 * ```typescript
 * const level = useLayout(Level1Layout, { lazy: true })
 * await level.load()
 * level.refs.player.api.takeDamage(10)
 * await level.dispose()
 * ```
 */

import { useEngine, engineContext } from '../context.js';
import { _withLayoutContext } from './place.js';
import type { LayoutDefinition, LayoutHandle, UseLayoutOptions, PlaceHandle } from './types.js';

/**
 * Returns a handle for loading and disposing a layout instance.
 *
 * Must be called inside an active engine context (e.g. `engine.run()`, a `defineSystem()`
 * factory, or a plugin `setup()` callback).
 *
 * @param layoutDef - The layout definition produced by `defineLayout()`.
 * @param options   - `lazy`: defer load until `load()` is called.
 * @returns A `LayoutHandle` with `load()`, `dispose()`, `refs`, and `active`.
 *
 * @example
 * ```typescript
 * const world = useLayout(TownLayout, { lazy: true })
 * await world.load()
 * world.refs.innkeeper.api.startDialogue()
 * await world.dispose()
 * ```
 */
export function useLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  layoutDef: LayoutDefinition<Refs>,
  options: UseLayoutOptions = {},
): LayoutHandle<Refs> {
  const engine = useEngine();

  let _active = false;
  let _refs: Refs = {} as Refs;
  let _entityIds: bigint[] = [];

  /**
   * Load the layout by executing its factory inside the layout context.
   * Stores entity IDs for later bulk destruction.
   * Re-establishes the engine context even if called outside the original engine.run()
   */
  async function load(): Promise<void> {
    if (_active) return;

    if (options?.chunkSize !== undefined) {
      console.warn(
        '[GWEN] useLayout: chunkSize is not yet implemented — all entities will be spawned at once.',
      );
    }

    const { result, entities } = engineContext.call(engine, () =>
      _withLayoutContext(() => layoutDef._factory()),
    );
    _refs = result;
    _entityIds = entities;
    _active = true;
  }

  /**
   * Dispose the layout by bulk-destroying all owned entities.
   * Idempotent — safe to call on an already-inactive layout.
   */
  async function dispose(): Promise<void> {
    if (!_active) return;

    if (_entityIds.length > 0) {
      const bridge = engine._getPlacementBridge();
      if (bridge?.bulk_destroy) {
        const indices = new Uint32Array(_entityIds.map((id) => Number(id) & 0xffffffff));
        bridge.bulk_destroy(indices);
      } else {
        // Fallback: destroy entities one-by-one if bulk_destroy is not available
        for (const id of _entityIds) {
          try {
            engine.destroyEntity(id as never);
          } catch {
            /* already destroyed */
          }
        }
      }
    }

    _entityIds = [];
    _refs = {} as Refs;
    _active = false;
  }

  const handle: LayoutHandle<Refs> = {
    get refs() {
      return _refs;
    },
    get active() {
      return _active;
    },
    load,
    dispose,
  };

  if (!options.lazy) {
    void load();
  }

  return handle;
}
