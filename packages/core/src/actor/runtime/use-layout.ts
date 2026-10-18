/**
 * @file `useLayout()` — composable for loading and disposing layout instances.
 *
 * A layout is loaded by executing its factory function inside both the engine context
 * and a layout context (`_withLayoutContext`). The resulting entity IDs are stored so
 * `dispose()` can call `bulk_destroy` in a single WASM call.
 *
 * With `chunkSize: n` the factory still runs once, but the `place*` calls only record
 * their spawn. `load()` then spawns at most `n` of them per frame, on `engine:before-update`,
 * and resolves once every entity is alive.
 *
 * @example
 * ```typescript
 * const level = useLayout(Level1Layout, { lazy: true })
 * await level.load()
 * level.refs.player.api.takeDamage(10)
 * await level.dispose()
 * ```
 */

import { useEngine } from "../../engine/context";
import { popEngine, pushEngine } from "../../engine/engine-local";
import { toGwenWasmError } from "../../engine/wasm-bridge";
import { _withLayoutContext } from "./place";
import { ComposableErrorCodes, GwenComposableError } from "../../engine/engine-errors";
import { entityIndex } from "../../engine/engine-api";
import type { EntityId } from "../../engine/engine-api";
import type { LayoutDefinition, LayoutHandle, UseLayoutOptions, PlaceHandle } from "./types";

/**
 * Returns a handle for loading and disposing a layout instance.
 *
 * Must be called inside an active engine context (e.g. `engine.run()`, a `defineSystem()`
 * factory, or a plugin `setup()` callback).
 *
 * @param layoutDef - The layout definition produced by `defineLayout()`.
 * @param options   - `lazy`: defer load until `load()` is called.
 *                    `chunkSize`: spawn at most this many entities per frame (positive integer).
 * @returns A `LayoutHandle` with `load()`, `dispose()`, `refs`, and `active`.
 * @throws {GwenComposableError} `COMPOSABLE:INVALID_CHUNK_SIZE` if `chunkSize` is not a positive integer.
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
  const chunkSize = options.chunkSize;
  if (chunkSize !== undefined && !(Number.isInteger(chunkSize) && chunkSize > 0)) {
    throw new GwenComposableError(
      ComposableErrorCodes.INVALID_CHUNK_SIZE,
      `[GWEN] useLayout: chunkSize must be a positive integer, received ${String(chunkSize)}.`,
    );
  }

  const engine = useEngine();

  let _active = false;
  let _refs: Refs = {} as Refs;
  let _entityIds: bigint[] = [];
  /** Pending progressive load, shared by every `load()` call until it settles. */
  let _pending: Promise<void> | undefined;
  /** Stops the pending progressive load: unsubscribes the frame hook and settles `_pending`. */
  let _cancel: (() => void) | undefined;

  /** One pass: run the factory, every `place*` call spawns at once. */
  function loadOnePass(): void {
    const previous = pushEngine(engine);
    let result: Refs | undefined;
    let entities: EntityId[] = [];
    try {
      const loaded = _withLayoutContext(() => layoutDef._factory());
      result = loaded.result;
      entities = loaded.entities;
    } finally {
      popEngine(engine, previous);
    }
    if (result !== undefined) _refs = result;
    _entityIds = entities;
    _active = true;
  }

  /**
   * Progressive: run the factory once with deferred `place*` calls, then spawn at most
   * `size` of them per `engine:before-update`. `refs` and `active` are set when the last
   * one has run.
   */
  function loadProgressive(size: number): Promise<void> {
    const previous = pushEngine(engine);
    let loaded: ReturnType<typeof _withLayoutContext<Refs>>;
    try {
      loaded = _withLayoutContext(() => layoutDef._factory(), { deferred: true });
    } finally {
      popEngine(engine, previous);
    }
    const { result, entities, queue } = loaded;
    _entityIds = entities;

    if (queue.length === 0) {
      if (result !== undefined) _refs = result;
      _active = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let next = 0;
      const stop = (): void => {
        unhook();
        _cancel = undefined;
        _pending = undefined;
      };
      const unhook = engine.hooks.hook("engine:before-update", () => {
        const slice = queue.slice(next, next + size);
        const frameEngine = pushEngine(engine);
        try {
          for (const spawn of slice) {
            spawn();
            next += 1;
          }
        } catch (error: unknown) {
          stop();
          destroyOwned();
          reject(error);
          return;
        } finally {
          popEngine(engine, frameEngine);
        }
        if (next < queue.length) return;
        if (result !== undefined) _refs = result;
        _active = true;
        stop();
        resolve();
      });
      _cancel = () => {
        stop();
        resolve();
      };
    });
  }

  /**
   * Load the layout.
   *
   * Without `chunkSize`: one pass, entities are alive when the returned promise resolves.
   * With `chunkSize`: the promise resolves once the last chunk has spawned. A second call
   * while loading returns the same promise. `dispose()` during the load resolves it with
   * the layout inactive.
   * Re-establishes the engine context even if called outside the original engine.run()
   */
  function load(): Promise<void> {
    if (_active) return Promise.resolve();
    if (_pending !== undefined) return _pending;
    try {
      if (chunkSize === undefined) {
        loadOnePass();
        return Promise.resolve();
      }
      _pending = loadProgressive(chunkSize);
      return _pending;
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** Bulk-destroy every entity spawned so far and forget them. */
  function destroyOwned(): void {
    if (_entityIds.length > 0) {
      const bridge = engine.getPlacementBridge();
      if (bridge?.bulk_destroy) {
        const indices = new Uint32Array(_entityIds.map((id) => entityIndex(id as EntityId)));
        const impl = engine.tryInject("wasm:bridge");
        if (impl) {
          impl.bulkDestroy(indices);
        } else {
          try {
            bridge.bulk_destroy(indices);
          } catch (error: unknown) {
            throw toGwenWasmError(error, "bulk_destroy", () => undefined);
          }
        }
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
  }

  /**
   * Dispose the layout by bulk-destroying all owned entities.
   * During a progressive load: stops further spawns, destroys what exists, and resolves
   * the pending `load()` with the layout inactive.
   * Idempotent — safe to call on an already-inactive layout.
   */
  async function dispose(): Promise<void> {
    if (!_active && _cancel === undefined) return;
    _cancel?.();
    destroyOwned();
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
