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
    // Owned from the first entity on, so a throwing factory or `place*` call can clean up.
    const entities: EntityId[] = [];
    _entityIds = entities;
    let result: Refs | undefined;
    try {
      result = _withLayoutContext(() => layoutDef._factory(), { entities }).result;
    } catch (error: unknown) {
      try {
        destroyIds(entities);
      } catch {
        /* keep the load error: it is the first failure */
      }
      throw error;
    } finally {
      popEngine(engine, previous);
    }
    if (result !== undefined) _refs = result;
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
    const { result, entities } = loaded;
    const queue = loaded.queue ?? [];
    _entityIds = entities;

    if (queue.length === 0) {
      if (result !== undefined) _refs = result;
      _active = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let next = 0;
      /**
       * Set by dispose(), engine.stop() or a failed spawn. The hook chain of a frame is built
       * before it runs, so a hook that was already unsubscribed can still fire once: it must
       * check this flag.
       */
      let cancelled = false;
      const stop = (): void => {
        cancelled = true;
        unhook();
        unhookStop();
        _cancel = undefined;
        _pending = undefined;
      };
      const unhook = engine.hooks.hook("engine:before-update", () => {
        if (cancelled) return;
        const slice = queue.slice(next, next + size);
        const frameEngine = pushEngine(engine);
        try {
          for (const spawn of slice) {
            spawn();
            next += 1;
            if (cancelled) break;
          }
        } catch (error: unknown) {
          stop();
          try {
            destroyIds(entities);
          } catch {
            /* keep the spawn error: it is the first failure */
          }
          reject(error);
          return;
        } finally {
          popEngine(engine, frameEngine);
        }
        if (cancelled) {
          // dispose() ran inside a spawn: the entity it was building is registered only now.
          // A frame hook must not throw: report a failed cleanup on the error bus instead.
          try {
            destroyIds(entities);
          } catch (error: unknown) {
            reportDisposeFailure(error);
          }
          return;
        }
        if (next < queue.length) return;
        if (result !== undefined) _refs = result;
        _active = true;
        stop();
        resolve();
      });
      // A stopped engine runs no more frames: settle like dispose().
      // engine.stop() must not reject because a layout failed to clean up.
      const unhookStop = engine.hooks.hook("engine:stop", () =>
        dispose().catch((error: unknown) => reportDisposeFailure(error)),
      );
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
   * while loading returns the same promise. `dispose()` or `engine.stop()` during the load
   * resolves it with the layout inactive.
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
      const loading = loadProgressive(chunkSize);
      // Only a load that subscribed to the frame hook is still pending.
      if (_cancel !== undefined) _pending = loading;
      return loading;
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** Report a cleanup failure that nobody awaits (frame hook, engine stop). */
  function reportDisposeFailure(error: unknown): void {
    engine.errors.emit({
      level: "error",
      code: ComposableErrorCodes.LAYOUT_DISPOSE_FAILED,
      message: "[GWEN] useLayout: destroying the layout entities failed.",
      source: "useLayout",
      error,
    });
  }

  /** Bulk-destroy every entity spawned so far and forget them. */
  function destroyOwned(): void {
    destroyIds(_entityIds);
  }

  /** Bulk-destroy `ids` and empty the array in place, even if destroying throws. */
  function destroyIds(ids: bigint[]): void {
    try {
      destroyList(ids);
    } finally {
      ids.length = 0;
    }
  }

  function destroyList(ids: bigint[]): void {
    if (ids.length > 0) {
      const bridge = engine.getPlacementBridge();
      if (bridge?.bulk_destroy) {
        const indices = new Uint32Array(ids.map((id) => entityIndex(id as EntityId)));
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
        for (const id of ids) {
          try {
            engine.destroyEntity(id as never);
          } catch {
            /* already destroyed */
          }
        }
      }
    }
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
    try {
      destroyOwned();
    } finally {
      _refs = {} as Refs;
      _active = false;
    }
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
    // Nobody awaits a non-lazy load: report a failure on the engine error bus.
    load().catch((error: unknown) => {
      engine.errors.emit({
        level: "error",
        code: ComposableErrorCodes.LAYOUT_LOAD_FAILED,
        message: "[GWEN] useLayout: the layout load failed.",
        source: "useLayout",
        error,
      });
    });
  }

  return handle;
}
