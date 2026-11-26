/**
 * Provides `defineSystem()` and the lifecycle composables (`onUpdate`, `onBeforeUpdate`,
 * `onAfterUpdate`, `onRender`) for writing game systems without class boilerplate.
 *
 * Systems register their lifecycle callbacks during a synchronous `setup()` phase.
 * Composables (`useEngine()`, `usePhysics2D()`, etc.) are resolved during setup
 * and remain available inside the registered callbacks.
 *
 * @example
 * ```typescript
 * export const playerSystem = defineSystem(() => {
 *   const input = useInput()         // resolved once at setup
 *   const physics = usePhysics2D()   // resolved once at setup
 *   const entities = useQuery([Position, PlayerTag])
 *
 *   onUpdate((dt) => {
 *     for (const e of entities.each()) {
 *       if (input.keyboard.isDown('ArrowRight')) {
 *         physics.setLinearVelocity(e.id, { x: 200 * dt, y: 0 })
 *       }
 *     }
 *   })
 * })
 * ```
 */

import { GwenError } from "@gwenjs/schema";
import { CoreErrorCodes } from "../../engine/engine-errors";
import { useEngine, GwenContextError, GwenContextErrorCodes } from "../../engine/context";
import type {
  GwenPlugin,
  GwenProvides,
  GwenWasmModules,
  WasmModuleHandle,
} from "../../engine/engine-types";
import type { EntityId } from "../../engine/engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../../schema";
import { ScopedHookable, releaseSlots, type HookSlots } from "../../hooks/scoped-hookable.js";
import { forgetTarget, isIsolated, targetFromScopeMeta } from "../../engine/error-isolation.js";
import {
  DefinitionRecord,
  HOT_CONTROL,
  HOT_RECORD,
  systemInstalls,
  type HotControl,
  type RebuildResult,
  type RetiredSystem,
  type SystemInstall,
} from "../../hmr/installs.js";
import { GwenScope } from "../../context/scope.js";
import { releaseChunkQuery, type Query } from "../../engine/chunk-query.js";

/** A component selector accepted by {@link useQuery}. */
export type ComponentDef = ComponentDefinition<ComponentSchema>;

// ─── Internal types ──────────────────────────────────────────────────────────

/** A frame update callback receiving delta time in seconds. */
type UpdateFn = (dt: number) => void;

/** A render callback. `alpha` is the display-frame interpolation factor. */
type RenderFn = (alpha: number) => void;

// ─── Lifecycle composables ───────────────────────────────────────────────────

/**
 * Returns the active scope when it is a system or an actor scope.
 *
 * A scene factory and a plugin setup run in a scope too (`scene`, `plugin`).
 * They do not own a frame loop, so they are rejected.
 *
 * @param composable - Public name reported in the error.
 * @throws {GwenContextError} `CORE:OUTSIDE_SYSTEM_CONTEXT` for any other scope.
 */
function frameScope(composable: string): GwenScope {
  const scope = GwenScope.current();
  if (scope?.meta.type !== "system" && scope?.meta.type !== "actor") {
    throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_SYSTEM_CONTEXT, composable);
  }
  return scope;
}

/**
 * Registers a callback to run every frame during the `engine:before-update`
 * phase — before physics. Must be called synchronously inside a
 * {@link defineSystem} setup callback or a {@link defineActor} factory.
 *
 * @param fn - Callback receiving delta time in seconds.
 * @throws {GwenContextError} `CORE:OUTSIDE_SYSTEM_CONTEXT` outside a system or an actor factory.
 */
export function onBeforeUpdate(fn: UpdateFn): void {
  const scope = frameScope("onBeforeUpdate");
  scope.hook("engine:before-update", fn);
}

/**
 * Registers a callback to run every frame during the `engine:update` phase —
 * after physics. Must be called synchronously inside a {@link defineSystem}
 * setup callback or a {@link defineActor} factory.
 *
 * @param fn - Callback receiving delta time in seconds.
 * @throws {GwenContextError} `CORE:OUTSIDE_SYSTEM_CONTEXT` outside a system or an actor factory.
 */
export function onUpdate(fn: UpdateFn): void {
  const scope = frameScope("onUpdate");
  scope.hook("engine:update", fn);
}

/**
 * Registers a callback to run every frame during the `engine:after-update`
 * phase. Must be called synchronously inside a {@link defineSystem} setup
 * callback or a {@link defineActor} factory.
 *
 * @param fn - Callback receiving delta time in seconds.
 * @throws {GwenContextError} `CORE:OUTSIDE_SYSTEM_CONTEXT` outside a system or an actor factory.
 */
export function onAfterUpdate(fn: UpdateFn): void {
  const scope = frameScope("onAfterUpdate");
  scope.hook("engine:after-update", fn);
}

/**
 * Registers a callback to run once per display frame during `engine:render`.
 * `alpha` is the interpolation factor, not a delta time. Must be called
 * synchronously inside a {@link defineSystem} setup callback or a
 * {@link defineActor} factory.
 *
 * @param fn - Render callback. Receives `alpha`.
 * @throws {GwenContextError} `CORE:OUTSIDE_SYSTEM_CONTEXT` outside a system or an actor factory.
 */
export function onRender(fn: RenderFn): void {
  const scope = frameScope("onRender");
  scope.hook("engine:render", fn);
}

// ─── DiscoverablePlugin ───────────────────────────────────────────────────────

/**
 * Extension of {@link GwenPlugin} produced by `defineSystem()`.
 *
 * Adds a `_discover()` method used by `useSystem()` to run the system's setup
 * function in collect mode (no-op frame callbacks, active engine context) so
 * that `useActor()` calls inside the factory register their actor plugins as
 * scene dependencies before the bootstrap installs anything via `engine.use()`.
 *
 * @internal
 */
export interface DiscoverablePlugin extends GwenPlugin {
  /**
   * Run the system setup in collect mode.
   *
   * Frame-phase callbacks (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`,
   * `onRender`) are no-ops. All other composables (`useActor`, `useQuery`,
   * `useService`) execute normally inside the active engine context.
   *
   * Must be called inside an active engine context (e.g. from within
   * `engine.run()`). `useSystem()` calls this automatically.
   *
   * **Note:** The system setup runs twice — once in collect mode and once
   * during `engine.use()`. Side-effect-free composables are unaffected.
   * A `console.log` inside the setup function will print twice; this is
   * documented behaviour.
   */
  _discover(): void;

  /**
   * Pause the system's ScopedHookable, silencing all registered frame handlers.
   * Called by `SystemHandle.pause()`.
   * @internal
   */
  _pause(): void;

  /**
   * Resume the system's ScopedHookable, re-enabling frame handlers.
   * Called by `SystemHandle.resume()`.
   * @internal
   */
  _resume(): void;

  /**
   * True while this system's scope is in `engine.isolated()`.
   * `resume()` does not clear it.
   * @internal
   */
  _isIsolated(): boolean;
}

// ─── defineSystem ─────────────────────────────────────────────────────────────

/** Stands in for the setup of a named system defined without one. Throws when the system is set up. */
function missingSetup(): never {
  throw new GwenError(
    CoreErrorCodes.DEFINITION_INCOMPLETE,
    "defineSystem(name, setup) needs a setup function as second argument.",
    { composable: "defineSystem" },
  );
}

/**
 * Defines a game system using the composable pattern.
 *
 * Returns a **factory function** that, when called with its dependency arguments,
 * produces a {@link GwenPlugin} ready to be passed to `useSystem()`.
 *
 * The factory form enables typed dependency injection: systems declare their
 * dependencies as parameters and receive them from the scene, keeping systems
 * decoupled from concrete actor types.
 *
 * The setup function runs **once** when the plugin is registered via `engine.use()`.
 * During setup the engine context is active — composables (`useEngine()`,
 * `useQuery()`, `useService()`, `useActor()`) may be called to capture references
 * used inside the registered lifecycle callbacks.
 *
 * **Naming:** prefer one of these two forms so the engine can identify the system:
 * - `export const ScoreSystem = defineSystem('ScoreSystem', () => { ... })` — explicit name
 * - With the Vite plugin, the name is injected automatically from the exported variable.
 *
 * @param nameOrSetup - System name string **or** setup function (single-arg form).
 * @param setup       - Setup function when the first arg is a name string.
 * @returns A factory function. Calling the factory with dependency arguments
 *          produces a {@link GwenPlugin}.
 * @throws {GwenError} code `CORE:DEFINITION_INCOMPLETE`, when the system is set up,
 *   if `defineSystem(name)` was called without the setup function. Before this check
 *   the set-up threw a `TypeError`.
 *
 * @example
 * ```typescript
 * // Zero-dependency system
 * export const MovementSystem = defineSystem(() => {
 *   const entities = useQuery([Position, Velocity])
 *   onUpdate((dt) => {
 *     for (const entity of entities.each()) {
 *       Position.x[entity.id] += Velocity.x[entity.id] * dt
 *     }
 *   })
 * })
 * // Usage: useSystem(MovementSystem())
 *
 * // System with dependency injection
 * export const CombatSystem = defineSystem((player: PlayerAPI) => {
 *   onUpdate(() => player.takeDamage(10))
 * })
 * // Usage: useSystem(CombatSystem(player))
 * ```
 */
export function defineSystem<Args extends unknown[]>(
  name: string,
  setup: (...args: Args) => void,
): (...args: Args) => DiscoverablePlugin;
export function defineSystem<Args extends unknown[]>(
  setup: (...args: Args) => void,
): (...args: Args) => DiscoverablePlugin;
export function defineSystem<Args extends unknown[]>(
  nameOrSetup: string | ((...args: Args) => void),
  maybeSetup?: (...args: Args) => void,
): (...args: Args) => DiscoverablePlugin {
  const named = typeof nameOrSetup === "string";
  const systemName = named ? nameOrSetup : nameOrSetup.name || "";
  const setupTemplate = named ? (maybeSetup ?? missingSetup) : nameOrSetup;

  if (!systemName) {
    // eslint-disable-next-line no-console
    console.warn(
      "[GWEN] defineSystem() called without a name. " +
        "Pass a name as first argument: defineSystem('mySystem', () => { ... })",
    );
  }

  const pluginName = systemName || "anonymous-system";
  // Dev only: a production build builds no record.
  const record = __GWEN_DEV__ ? new DefinitionRecord<Args>(pluginName) : null;

  const factory = (...args: Args): DiscoverablePlugin => {
    let _scope: ScopedHookable | null = null;
    let _gwenScope: GwenScope | null = null;
    let _engine: object | null = null;
    let _discovered = false;
    // Dev only: what a hot swap needs. Unused in a production build.
    let _install: SystemInstall<Args> | null = null;
    let _root: HotControl | null = null;
    let _forward: DiscoverablePlugin | null = null;
    let _parked: RetiredSystem | null = null;

    /** Create the scope and run the setup. `adopt` carries the slots of a swapped-out body. */
    const begin = (adopt?: HookSlots): void => {
      const engine = useEngine();
      _engine = engine;
      _scope = new ScopedHookable(engine.hooks, adopt);
      _gwenScope = new GwenScope(
        engine,
        {
          type: "system",
          name: pluginName,
        },
        null,
        _scope, // Pass _scope so pause/resume work correctly
      );
      _gwenScope.run(() => setupTemplate(...args));
    };

    /** Record this instance on its definition and on its engine. */
    const track = (): void => {
      const id = _gwenScope?.meta.id;
      const engine = useEngine();
      if (id === undefined || control === null || record === null) return;
      _install = { id, engine, args, control, root: _root ?? control };
      record.installs.add(_install);
      if (!engine.disposables.closed) {
        systemInstalls.get(engine).set(id, { id, name: pluginName, scope: _scope });
      }
    };

    const untrack = (): void => {
      if (_install === null) return;
      record?.installs.delete(_install);
      systemInstalls.peek(_install.engine)?.delete(_install.id);
      _install = null;
    };

    /** Drop the isolation entry of a failed swap. */
    const dropIsolation = (): void => {
      const id = _gwenScope?.meta.id;
      if (id !== undefined && _engine !== null) forgetTarget(_engine, id);
    };

    // Dev only: a production build builds no control.
    const control: HotControl | null = __GWEN_DEV__
      ? {
          retire(): RetiredSystem {
            untrack();
            const parked = _parked;
            if (parked !== null) {
              _parked = null;
              dropIsolation();
              return parked;
            }
            const retired = {
              slots: _scope?.handOff() ?? new Map(),
              paused: _scope?.paused === true,
            };
            _scope = null;
            _gwenScope?.dispose();
            _gwenScope = null;
            return retired;
          },

          rebuild(from: RetiredSystem, root: HotControl): RebuildResult {
            _root = root;
            try {
              begin(from.slots);
            } catch (error) {
              // The scope may hold a half-run setup. Park every slot and dispose the rest.
              _parked = { slots: _scope?.park() ?? from.slots, paused: from.paused };
              _scope = null;
              _gwenScope?.dispose();
              track();
              const meta = _gwenScope?.meta;
              if (meta === undefined) throw error;
              return { ok: false, error, target: targetFromScopeMeta(meta) };
            }
            _scope?.finishAdopt();
            if (from.paused) _scope?.pause();
            track();
            return { ok: true };
          },

          redirect(to: DiscoverablePlugin): void {
            _forward = to;
          },
        }
      : null;

    const plugin: DiscoverablePlugin = {
      name: pluginName,

      setup(engine): void {
        if (_discovered) return;
        // A swapped-in body stays installed after a teardown: a later setup runs the newest body.
        if (__GWEN_DEV__) {
          if (_forward !== null) {
            void _forward.setup(engine);
            return;
          }
        }
        begin();
        if (__GWEN_DEV__) track();
      },

      _discover(): void {
        _discovered = true;
        begin();
        if (__GWEN_DEV__) track();
      },

      teardown(): void {
        if (__GWEN_DEV__) {
          if (_forward !== null) {
            _forward.teardown?.();
            return;
          }
          untrack();
          if (_parked !== null) {
            releaseSlots(_parked.slots);
            _parked = null;
            dropIsolation();
          }
        }
        _scope?.dispose();
        _scope = null;
        _gwenScope?.dispose();
        _gwenScope = null;
      },

      _pause(): void {
        if (__GWEN_DEV__) {
          if (_forward !== null) return _forward._pause();
          if (_parked !== null) _parked.paused = true;
        }
        _scope?.pause();
      },

      _resume(): void {
        if (__GWEN_DEV__) {
          if (_forward !== null) return _forward._resume();
          if (_parked !== null) _parked.paused = false;
        }
        _scope?.resume();
      },

      _isIsolated(): boolean {
        if (__GWEN_DEV__) {
          if (_forward !== null) return _forward._isIsolated();
        }
        const id = _gwenScope?.meta.id;
        if (!id || !_engine) return false;
        return isIsolated(_engine, id);
      },

      // NO onBeforeUpdate / onUpdate / onAfterUpdate / onRender methods.
      // Dispatch goes through engine.hooks → scope → registered handlers.
    };

    if (control !== null) Object.defineProperty(plugin, HOT_CONTROL, { value: control });
    return plugin;
  };
  // Hot swaps and dev tooling read the factory name.
  Object.defineProperty(factory, "name", { value: pluginName });
  if (record !== null) Object.defineProperty(factory, HOT_RECORD, { value: record });
  return factory;
}

// ─── useQuery ─────────────────────────────────────────────────────────────────

/**
 * Provides read access to a single entity's components during query iteration.
 *
 * Returned by {@link Query.each} or `createLiveQuery` on each iteration step.
 * {@link useQuery} yields chunks, not accessors. The accessor is valid only
 * for the duration of the current iteration — do not cache it across frames.
 *
 * @example
 * ```typescript
 * onUpdate(() => {
 *   for (const e of entities) {
 *     const pos = e.get(Position)
 *     console.log(e.id, pos.x, pos.y)
 *   }
 * })
 * ```
 */
export interface EntityAccessor<C extends readonly ComponentDef[]> {
  /** The entity's unique ID. */
  readonly id: EntityId;
  /**
   * Retrieve a readonly snapshot of one component in this query. Dev builds deep-freeze it.
   * A definition that was not queried is a compile error.
   * A missing value at runtime is a bug: the query only yields entities that have every def.
   *
   * @param def - One of the component definitions passed to the query
   */
  get<D extends C[number]>(def: D): Readonly<InferComponent<D>>;
}

/**
 * Iterable of entity accessors from {@link Query.each} or `createLiveQuery`.
 * {@link useQuery} returns a {@link Query}, not this type.
 *
 * The iterable is re-evaluated each time you iterate, reflecting the current
 * ECS state at that moment.
 *
 * @typeParam T - Entity accessor type
 */
export type { Query, QueryChunk, ChunkColumns } from "../../engine/chunk-query.js";
export type LiveQuery<T> = Iterable<T>;

/**
 * Defines a chunk query inside a {@link defineSystem} setup callback.
 *
 * Iteration yields chunks whose rows match every supplied component.
 * `each()` yields one accessor per matching entity, with the same rules as
 * `createLiveQuery`.
 *
 * @param components - List of component definitions to match
 * @param cacheKey - Optional cache key. It is no longer injected by any plugin.
 *                   Internal — do not pass manually.
 * @returns A chunk query. Column arrays are read with `chunk.get`. Accessors come from `each()`.
 *
 * @throws {GwenContextError} If called outside an active engine context
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   const enemies = useQuery([Position, EnemyTag])
 *
 *   onUpdate(() => {
 *     for (const chunk of enemies) {
 *       const pos = chunk.get(Position)
 *       pos.x[0] += 1
 *     }
 *   })
 * })
 * ```
 */
export function useQuery<const C extends readonly ComponentDef[]>(
  components: C,
  cacheKey?: string,
): Query<C> {
  const engine = useEngine("useQuery");
  const query = engine.createQuery(components, cacheKey);
  GwenScope.current()?.onCleanup(() => {
    releaseChunkQuery(query);
  });
  return query;
}

// ─── useService ───────────────────────────────────────────────────────────────

/**
 * Resolves a service registered via {@link GwenEngine.provide} inside the current engine context.
 *
 * This composable is the primary way to access plugin services from within a
 * {@link defineSystem} setup callback. Plugin packages extend the {@link GwenProvides}
 * interface via declaration merging to expose fully-typed, zero-cast service keys.
 *
 * The key must be declared on {@link GwenProvides}. There is no string fallback.
 *
 * @typeParam K - A key of the augmented {@link GwenProvides} map
 * @param key - The service key as registered with `engine.provide(key, value)`
 * @returns The service registered under `key`
 *
 * @throws {GwenContextError} If called outside an active engine context
 * @throws {GwenPluginNotFoundError} If no service has been registered under `key`
 *
 * @example
 * ```typescript
 * // 1. Plugin extends GwenProvides (declaration merging):
 * declare module '@gwenjs/core' {
 *   interface GwenProvides {
 *     physics2d: Physics2DAPI
 *   }
 * }
 *
 * // 2. Plugin registers the service during setup:
 * engine.provide('physics2d', physicsAPI)
 *
 * // 3. System resolves at setup time — fully typed, no cast:
 * export const movementSystem = defineSystem(() => {
 *   const physics = useService('physics2d') // inferred as Physics2DAPI
 *
 *   onUpdate((dt) => {
 *     physics.step(dt)
 *   })
 * })
 * ```
 *
 */
export function useService<K extends keyof GwenProvides>(key: K): GwenProvides[K] {
  return useEngine("useService").inject(key);
}

// ─── useWasmModule ────────────────────────────────────────────────────────────

/**
 * Returns the handle for a WASM module loaded via the engine.
 *
 * In most cases you should use the plugin's composable (e.g. `usePhysics2D()`)
 * instead of this low-level accessor.
 *
 * @param name - The module name as registered with the engine
 * @returns The WASM module exports
 * @throws {GwenContextError} If called outside an active engine context
 *
 * @example
 * ```typescript
 * const wasm = useWasmModule('pathfinder')
 * wasm.exports.findPath(fromX, fromY, toX, toY)
 * ```
 */
export function useWasmModule<K extends keyof GwenWasmModules>(
  name: K,
): WasmModuleHandle<GwenWasmModules[K]> {
  const engine = useEngine("useWasmModule");
  return engine.getWasmModule(name);
}
