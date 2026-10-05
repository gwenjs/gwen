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
 *     for (const e of entities) {
 *       if (input.keyboard.isDown('ArrowRight')) {
 *         physics.setLinearVelocity(e.id, { x: 200 * dt, y: 0 })
 *       }
 *     }
 *   })
 * })
 * ```
 */

import { useEngine, GwenContextError } from "../../engine/context";
import type { GwenPlugin, GwenProvides, WasmModuleHandle } from "../../engine/gwen-engine";
import type { EntityId } from "../../engine/engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../../schema";
import { ScopedHookable } from "../../hooks/scoped-hookable.js";
import { isIsolated } from "../../engine/error-isolation.js";
import { GwenScope } from "../../context/scope.js";

/** A component selector accepted by {@link useQuery}. */
export type ComponentDef = ComponentDefinition<ComponentSchema>;

// ─── Internal types ──────────────────────────────────────────────────────────

/** A frame update callback receiving delta time in seconds. */
type UpdateFn = (dt: number) => void;

/** A render callback (no delta time — called every frame at render phase). */
type RenderFn = () => void;

// ─── Lifecycle composables ───────────────────────────────────────────────────

/**
 * Registers a callback to run every frame during the `engine:before-update`
 * phase — before physics. Must be called synchronously inside a
 * {@link defineSystem} setup callback or a {@link defineActor} factory.
 *
 * @param fn - Callback receiving delta time in seconds.
 * @throws {GwenContextError} If called outside an active scope context.
 */
export function onBeforeUpdate(fn: UpdateFn): void {
  const scope = GwenScope.current();
  if (!scope) {
    throw new GwenContextError(
      "[GWEN] onBeforeUpdate() must be called inside a defineSystem() or defineActor() factory.",
    );
  }
  scope.hook("engine:before-update", fn);
}

/**
 * Registers a callback to run every frame during the `engine:update` phase —
 * after physics. Must be called synchronously inside a {@link defineSystem}
 * setup callback or a {@link defineActor} factory.
 *
 * @param fn - Callback receiving delta time in seconds.
 * @throws {GwenContextError} If called outside an active scope context.
 */
export function onUpdate(fn: UpdateFn): void {
  const scope = GwenScope.current();
  if (!scope) {
    throw new GwenContextError(
      "[GWEN] onUpdate() must be called inside a defineSystem() or defineActor() factory.",
    );
  }
  scope.hook("engine:update", fn);
}

/**
 * Registers a callback to run every frame during the `engine:after-update`
 * phase. Must be called synchronously inside a {@link defineSystem} setup
 * callback or a {@link defineActor} factory.
 *
 * @param fn - Callback receiving delta time in seconds.
 * @throws {GwenContextError} If called outside an active scope context.
 */
export function onAfterUpdate(fn: UpdateFn): void {
  const scope = GwenScope.current();
  if (!scope) {
    throw new GwenContextError(
      "[GWEN] onAfterUpdate() must be called inside a defineSystem() or defineActor() factory.",
    );
  }
  scope.hook("engine:after-update", fn);
}

/**
 * Registers a callback to run every frame during the `engine:render` phase.
 * No delta time — use for draw calls only. Must be called synchronously inside
 * a {@link defineSystem} setup callback or a {@link defineActor} factory.
 *
 * @param fn - Render callback.
 * @throws {GwenContextError} If called outside an active scope context.
 */
export function onRender(fn: RenderFn): void {
  const scope = GwenScope.current();
  if (!scope) {
    throw new GwenContextError(
      "[GWEN] onRender() must be called inside a defineSystem() or defineActor() factory.",
    );
  }
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
 *
 * @example
 * ```typescript
 * // Zero-dependency system
 * export const MovementSystem = defineSystem(() => {
 *   const entities = useQuery([Position, Velocity])
 *   onUpdate((dt) => {
 *     for (const id of entities) {
 *       Position.x[id] += Velocity.x[id] * dt
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineSystem<Args extends any[]>(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup: (...args: Args) => void,
): (...args: Args) => DiscoverablePlugin;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineSystem<Args extends any[]>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setup: (...args: Args) => void,
): (...args: Args) => DiscoverablePlugin;
export function defineSystem<Args extends unknown[]>(
  nameOrSetup: string | ((...args: Args) => void),
  maybeSetup?: (...args: Args) => void,
): (...args: Args) => DiscoverablePlugin {
  const systemName =
    typeof nameOrSetup === "string" ? nameOrSetup : (nameOrSetup as { name?: string }).name || "";
  const setupTemplate = typeof nameOrSetup === "function" ? nameOrSetup : maybeSetup!;

  if (!systemName) {
    // eslint-disable-next-line no-console
    console.warn(
      "[GWEN] defineSystem() called without a name. " +
        "Pass a name as first argument: defineSystem('mySystem', () => { ... })",
    );
  }

  return (...args: Args): DiscoverablePlugin => {
    let _scope: ScopedHookable | null = null;
    let _gwenScope: GwenScope | null = null;
    let _engine: object | null = null;
    let _discovered = false;

    const plugin: DiscoverablePlugin = {
      name: systemName || "anonymous-system",

      setup(): void {
        if (_discovered) return;
        const engine = useEngine();
        _engine = engine;
        _scope = new ScopedHookable(engine.hooks);
        _gwenScope = new GwenScope(
          engine as any,
          {
            type: "system",
            name: systemName || "anonymous-system",
          },
          null,
          _scope, // Pass _scope so pause/resume work correctly
        );
        _gwenScope.run(() => setupTemplate(...args));
      },

      _discover(): void {
        _discovered = true;
        const engine = useEngine();
        _engine = engine;
        _scope = new ScopedHookable(engine.hooks);
        _gwenScope = new GwenScope(
          engine as any,
          {
            type: "system",
            name: systemName || "anonymous-system",
          },
          null,
          _scope, // Pass _scope so pause/resume work correctly
        );
        _gwenScope.run(() => setupTemplate(...args));
      },

      teardown(): void {
        _scope?.dispose();
        _scope = null;
        _gwenScope?.dispose();
        _gwenScope = null;
      },

      _pause(): void {
        _scope?.pause();
      },

      _resume(): void {
        _scope?.resume();
      },

      _isIsolated(): boolean {
        const id = _gwenScope?.meta.id;
        if (!id || !_engine) return false;
        return isIsolated(_engine, id);
      },

      // NO onBeforeUpdate / onUpdate / onAfterUpdate / onRender methods.
      // Dispatch goes through engine.hooks → scope → registered handlers.
    };

    return plugin;
  };
}

// ─── useQuery ─────────────────────────────────────────────────────────────────

/**
 * Provides read access to a single entity's components during query iteration.
 *
 * Returned by {@link useQuery} on each iteration step. The accessor is valid only
 * for the duration of the current iteration — do not cache it across frames.
 *
 * @example
 * ```typescript
 * onUpdate(() => {
 *   for (const e of entities) {
 *     const pos = e.get(Position)
 *     if (pos) console.log(e.id, pos.x, pos.y)
 *   }
 * })
 * ```
 */
export interface EntityAccessor {
  /** The entity's unique ID. */
  readonly id: EntityId;
  /**
   * Retrieve the current component data for the given definition.
   *
   * @param def - The component definition to look up
   * @returns The component data, or `undefined` if the entity does not have it
   */
  get<S extends ComponentSchema, D extends ComponentDefinition<S>>(
    def: D,
  ): InferComponent<D> | undefined;
}

/**
 * A live query result — an iterable of entity accessors.
 * Returned by {@link useQuery} inside a {@link defineSystem} setup callback.
 *
 * The iterable is re-evaluated each time you iterate, reflecting the current
 * ECS state at that moment.
 *
 * @typeParam T - Entity accessor type (defaults to {@link EntityAccessor})
 */
export type LiveQuery<T = EntityAccessor> = Iterable<T>;

/**
 * Defines a reactive entity query inside a {@link defineSystem} setup callback.
 *
 * The returned iterable reflects the current ECS state at each iteration —
 * entities that match all supplied component definitions at the time you iterate.
 *
 * @param components - List of component definitions to match
 * @param _cacheKey - Pre-computed cache key injected by the Vite transform.
 *                    Internal — do not pass manually.
 * @returns A live query iterable of {@link EntityAccessor} objects
 *
 * @throws {GwenContextError} If called outside an active engine context
 *
 * @example
 * ```typescript
 * defineSystem(() => {
 *   const enemies = useQuery([Position, EnemyTag])
 *
 *   onUpdate(() => {
 *     for (const entity of enemies) {
 *       // reflects current ECS state at each iteration
 *       const pos = entity.get(Position)
 *     }
 *   })
 * })
 * ```
 */
export function useQuery(components: ComponentDef[], _cacheKey?: string): LiveQuery {
  const engine = useEngine();
  return engine.createLiveQuery(components, _cacheKey);
}

// ─── useService ───────────────────────────────────────────────────────────────

/**
 * Resolves a service registered via {@link GwenEngine.provide} inside the current engine context.
 *
 * This composable is the primary way to access plugin services from within a
 * {@link defineSystem} setup callback. Plugin packages extend the {@link GwenProvides}
 * interface via declaration merging to expose fully-typed, zero-cast service keys.
 *
 * Two call signatures are supported:
 * - **Typed** — when the key is declared in `GwenProvides` via declaration merging,
 *   the return type is inferred automatically (no cast needed).
 * - **Generic fallback** — pass a plain `string` and supply a type parameter `T`
 *   for cases where the plugin has not yet declared its key.
 *
 * @typeParam K - A key of the augmented {@link GwenProvides} map (typed overload)
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
 * @example
 * ```typescript
 * // Generic fallback when GwenProvides is not yet augmented:
 * const myService = useService<MyServiceAPI>('my-service')
 * ```
 */
export function useService<K extends keyof GwenProvides>(key: K): GwenProvides[K];
export function useService<T = unknown>(key: string): T;
export function useService(key: string): unknown {
  return useEngine().inject(key as keyof GwenProvides);
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
 * const wasm = useWasmModule<PathfinderExports>('pathfinder')
 * wasm.exports.findPath(fromX, fromY, toX, toY)
 * ```
 */
export function useWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
  name: string,
): WasmModuleHandle<Exports> {
  const engine = useEngine();
  return engine.getWasmModule<Exports>(name);
}
