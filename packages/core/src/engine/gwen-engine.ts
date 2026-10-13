/**
 * Provides the new `createEngine(options?) → Promise<GwenEngine>` API.
 *
 * NAVIGATION (use IDE region folding — Ctrl+Shift+[ / Cmd+Shift+[):
 *   engine-errors.ts                            — error classes & codes
 *   engine-types.ts                             — all public type contracts
 *   hook-tracker.ts                             — ScopedHooksTracker
 *   plugin-registry.ts                          — PluginRegistry
 *   service-container.ts                        — ServiceContainer
 *   engine-entities.ts                          — EngineEntities
 *   engine-stats.ts                             — EngineStatsRecorder
 *   engine-state.ts                             — EngineStateMachine
 *   engine-error-policy.ts                      — EngineErrorPolicy
 *   engine-loop.ts                              — EngineLoop
 *   engine-collaborators.ts                     — collaborator construction
 *   hook-dispatch.ts                            — hook runners
 *   engine-internals.ts                         — pool dormancy and live query ids
 *   frame-scheduler.ts                          — rAF and worker fallback
 *   wasm-module-runner.ts                       — WasmModuleRunner
 *   #region Engine implementation               — GwenEngineImpl
 *   engine-factory.ts                           — createEngine and setupGwen
 */

import { GwenError, type GwenErrorTarget } from "@gwenjs/schema";
import { engineContext } from "./context";
import { gwenEngineSelf, popEngine, pushEngine } from "./engine-local";
import { componentRegistryFor, componentTypeIds } from "./engine-component-registry";
import type { EngineMemory } from "./engine-memory.js";
import type { EntityId } from "./engine-api";
import type { ComponentDefinition, ComponentSchema, InferComponent } from "../schema";
import type { ComponentDef, LiveQuery, EntityAccessor } from "../system/runtime/define-system";

import { CoreErrorCodes, GwenEngineStateError } from "./engine-errors.js";
import { EngineCollaborators } from "./engine-collaborators.js";

import type {
  WasmModuleOptions,
  WasmModuleHandle,
  PlacementBridge,
  EngineErrorBus,
  GwenProvides,
  GwenWasmModules,
  GwenPlugin,
  EngineStats,
  GwenEngineState,
  GwenEngine,
} from "./engine-types.js";
import type { ComponentType } from "../types";

// #region Engine implementation

export class GwenEngineImpl extends EngineCollaborators implements GwenEngine {
  /** Real engine behind a hooks proxy. */
  get [gwenEngineSelf](): this {
    return this;
  }

  protected asEngine(): GwenEngine {
    return this;
  }

  /** Engine that `activate()` replaced. Restored by `deactivate()` when this engine is still current. */
  private _engineBeforeActivate: GwenEngine | undefined;
  private _activateCaptured = false;
  /**
   * The one teardown claim allowed by the #107 amendment. Set when the first `stop()`
   * starts teardown. While it is set, every `stop()` returns at once. Only `stop()`
   * reads it; every other check reads `state`.
   */
  private _teardownOnce: true | null = null;

  get errors(): EngineErrorBus {
    return this._policy.bus;
  }

  isolated(): readonly GwenErrorTarget[] {
    return this._policy.isolated();
  }

  reenable(id: string): boolean {
    return this._policy.reenable(id);
  }

  get memory(): EngineMemory {
    return this._memory;
  }

  get state(): GwenEngineState {
    return this._stateMachine.state;
  }

  // ─── Plugin runner ────────────────────────────────────────────────────────

  use(plugin: GwenPlugin): Promise<void> {
    return this._pluginRegistry.use(plugin, this);
  }

  unuse(name: string): Promise<void> {
    return this._pluginRegistry.unuse(name, this);
  }

  // ─── Typed provide/inject ─────────────────────────────────────────────────

  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): void {
    this._serviceContainer.provide(key, value);
  }

  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K] {
    return this._serviceContainer.inject(key);
  }

  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined {
    return this._serviceContainer.tryInject(key);
  }

  // ─── Context (RFC-005) ────────────────────────────────────────────────────

  /**
   * Executes `fn` within this engine's context.
   * Composables (`useEngine()`, `usePhysics2D()`, etc.) resolve to this instance inside `fn`.
   *
   * @param fn - Synchronous function to execute in context
   * @returns The return value of `fn`
   *
   * @example
   * ```typescript
   * const instance = engine.run(() => useEngine())
   * // instance === engine ✓
   * ```
   */
  run<T>(fn: () => T): T {
    this._stateMachine.assert("run");
    const previous = pushEngine(this);
    try {
      return fn();
    } finally {
      popEngine(this, previous);
    }
  }

  /**
   * Sets this engine as the globally active context instance.
   * Prefer {@link run} for scoped context management.
   * Use `activate()` / `deactivate()` only when you control the lifecycle manually
   * (e.g., a custom game loop outside `advance()`).
   */
  activate(): void {
    this._stateMachine.assert("activate");
    if (!this._activateCaptured) {
      this._engineBeforeActivate = engineContext.tryUse() ?? undefined;
      this._activateCaptured = true;
    }
    engineContext.set(this, true);
  }

  /**
   * Restores the engine captured by {@link activate} when this engine is still current.
   * A no-op when another engine has replaced the context.
   */
  deactivate(): void {
    this._stateMachine.assert("deactivate");
    if (engineContext.tryUse() !== this) return;
    const previous = this._engineBeforeActivate;
    this._engineBeforeActivate = undefined;
    this._activateCaptured = false;
    if (previous) engineContext.set(previous, true);
    else engineContext.unset();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the RAF or fixed-step loop.
   *
   * Throws {@link GwenEngineStateError} when `state` is not `idle`.
   * Throws {@link GwenError} `CORE:WASM_NOT_INITIALIZED` when the bridge is not
   * active. That check does not change `state` and does not schedule a frame.
   * A later `start()` throws again until `bridge.init()` or `setupGwen()` has run.
   */
  async start(): Promise<void> {
    const state = this._stateMachine.state;
    if (state !== "idle") throw new GwenEngineStateError(state, "start");
    if (!this._bridge.isActive()) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] WASM core not initialized.\n" +
          "Call `await bridge.init()` or `setupGwen()` before starting the Engine.",
      );
    }
    this._policy.attach();
    this._loop.markStart();
    await this._beginStart();
    if (this._stateMachine.state !== "running") return;
    this._loop.startScheduled();
  }

  /**
   * Tear down once. Only the first `stop()` runs teardown. A `stop()` called while
   * teardown runs returns immediately and does not wait for it, so awaiting `stop()`
   * inside `engine:stop` or an `engine:state-change` handler for `stopping` resolves.
   * To know when teardown has finished, observe `engine:state-change` to `stopped`.
   */
  async stop(): Promise<void> {
    if (this._teardownOnce !== null) return;
    const from = this._stateMachine.state;
    if (from === "stopped" || from === "stopping") return;
    if (from === "starting") throw new GwenEngineStateError(from, "stop");
    // Claim before the first hook runs: a stop() from inside teardown must see it.
    this._teardownOnce = true;
    if (from !== "faulted") await this._stateMachine.transition("stopping", "USER");
    await this._teardown();
  }

  /** Cancel the frame, run `engine:stop`, then clear hooks, this engine's module handles, and disposables. */
  private async _teardown(): Promise<void> {
    this._loop.cancel();
    try {
      await this.hooks.callHook("engine:stop");
    } catch (err) {
      this._policy.handleFrameLoopError(err);
    }
    this._pluginRegistry.clearHooks();
    this._policy.clearIsolated();

    // Per-engine module handles only. The glue cache is shared by variant:
    // another live engine may still need those keys.
    this._wasmRunner.clear();

    try {
      this.disposables.disposeAll(); // LIFO — last registered, first disposed
    } finally {
      this._policy.dispose();
      if (this._stateMachine.state === "stopping")
        await this._stateMachine.transition("stopped", "USER");
    }
  }

  /**
   * `idle → starting` before `engine:init`, then `starting → running` after `engine:start`.
   * A throw from either hook moves `starting` to `faulted` and rejects the caller.
   */
  private async _beginStart(): Promise<void> {
    await this._stateMachine.transition("starting", "USER");
    let hook: "engine:init" | "engine:start" = "engine:init";
    try {
      await this.hooks.callHook("engine:init");
      if (this._stateMachine.state !== "starting") return;
      hook = "engine:start";
      await this.hooks.callHook("engine:start");
    } catch (err) {
      this._stateMachine.enterFaulted("FATAL_ERROR");
      const message = err instanceof Error ? err.message : String(err);
      this._policy.emit({
        level: "fatal",
        code: CoreErrorCodes.FRAME_LOOP_ERROR,
        message,
        source: "@gwenjs/core",
        error: err,
        context: { frame: this._stats.frameCount, hook },
      });
      throw err;
    }
    if (this._stateMachine.state !== "starting") return;
    await this._stateMachine.transition("running", "USER");
  }

  /**
   * Initialise the engine for an externally driven loop.
   * Fires `engine:init` and `engine:start` hooks without launching a RAF loop.
   * Call this once, then drive frames by calling `advance(dt)` each tick.
   *
   * @example
   * ```typescript
   * await engine.startExternal()
   * // In a game loop / R3F useFrame:
   * engine.advance(1 / 60)
   * ```
   */
  async startExternal(): Promise<void> {
    const state = this._stateMachine.state;
    if (state !== "idle") throw new GwenEngineStateError(state, "startExternal");
    this._policy.attach();
    await this._beginStart();
    // Intentionally skip RAF — the caller drives the loop via advance().
  }

  advance(dt: number): Promise<void> {
    return this._loop.advance(dt);
  }

  // ─── WASM modules (RFC-008) ────────────────────────────────────────────────

  /**
   * Fetch and instantiate a WASM binary, then register it under `options.name`.
   * If a module with the same name is already loaded, returns the existing handle.
   *
   * @param options - Load options: name, URL, and optional per-frame step.
   * @returns The typed {@link WasmModuleHandle}.
   * @throws {GwenError} `CORE:WASM_LOAD_ERROR` when fetch, compile, the probe
   *   instantiate or the second instantiate fails.
   * @throws {GwenError} `CORE:WASM_NOT_INITIALIZED` when `transformRegion` is
   *   set and the WASM bridge is not active.
   * @throws {GwenError} `CORE:WASM_MODULE_REGION_TOO_SMALL` or
   *   `CORE:WASM_MODULE_REGION_INVALID` when `transformRegion` fails a load check.
   *   The module is not registered and the engine keeps running.
   * @throws {GwenError} `CORE:WASM_API_VERSION_MISMATCH` when `versionPolicy`
   *   is `throw` and `gwen_plugin_api_version` does not match.
   */
  loadWasmModule<Exports extends WebAssembly.Exports = WebAssembly.Exports>(
    options: WasmModuleOptions<Exports>,
  ): Promise<WasmModuleHandle<Exports>> {
    return this._wasmRunner.load(options);
  }

  /**
   * Retrieve a previously loaded WASM module handle by name.
   *
   * @param name - The name supplied to {@link loadWasmModule}.
   * @returns The typed {@link WasmModuleHandle}.
   * @throws {GwenError} If no module has been loaded under `name`.
   */
  getWasmModule<K extends keyof GwenWasmModules>(name: K): WasmModuleHandle<GwenWasmModules[K]> {
    return this._wasmRunner.get(name);
  }

  // ─── ECS entity management ────────────────────────────────────────────────

  /**
   * Create a new entity.
   * @returns A fresh {@link EntityId}.
   * @throws {GwenError} code `CORE:ENTITY_LIMIT_REACHED` when the entity capacity is exceeded.
   */
  createEntity(): EntityId {
    return this._entities.createEntity();
  }

  canSpawn(count: number): boolean {
    return this._entities.canSpawn(count);
  }

  /**
   * Destroy an entity and remove all its components.
   *
   * @param id - The entity to destroy
   * @returns `true` if it was alive and is now destroyed
   */
  destroyEntity(id: EntityId): boolean {
    return this._entities.destroyEntity(id);
  }

  /**
   * Check whether an entity is currently alive.
   *
   * @param id - The entity to check
   * @returns `true` if alive
   */
  isAlive(id: EntityId): boolean {
    return this._entities.isAlive(id);
  }

  // ─── ECS component management ─────────────────────────────────────────────

  /**
   * Rust component type id for `name`, owned by this engine.
   * The same name (including an HMR re-definition) keeps the same id.
   * Numeric ids are not baked by the Vite optimizer; cached lookup is #66.
   */
  getOrRegisterComponent(type: ComponentType): number {
    this._stateMachine.assert("getOrRegisterComponent");
    return componentRegistryFor(this).getOrRegister(type);
  }

  /** Names registered on this engine. Does not create the registry. */
  registeredComponentTypes(): ReadonlyMap<ComponentType, number> {
    return componentTypeIds(this);
  }

  /**
   * Attach a component to an entity.
   * Merges `def.defaults` with the supplied `data` (data wins on conflict).
   *
   * @param id - Target entity
   * @param def - Component definition
   * @param data - Partial data to store (merged with defaults)
   */
  addComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
    data: Partial<InferComponent<D>>,
  ): void {
    this._entities.addComponent(id, def, data);
  }

  /**
   * Retrieve a component from an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to look up
   * @returns The stored component data, or `undefined`
   */
  getComponent<D extends ComponentDefinition<ComponentSchema>>(
    id: EntityId,
    def: D,
  ): InferComponent<D> | undefined {
    return this._entities.getComponent(id, def);
  }

  /**
   * Check whether an entity has a specific component.
   *
   * @param id - Target entity
   * @param def - Component definition to check
   * @returns `true` if the component is present
   */
  hasComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    return this._entities.hasComponent(id, def);
  }

  /**
   * Remove a component from an entity.
   *
   * @param id - Target entity
   * @param def - Component definition to remove
   * @returns `true` if the component existed and was removed
   */
  removeComponent<D extends ComponentDefinition<ComponentSchema>>(id: EntityId, def: D): boolean {
    return this._entities.removeComponent(id, def);
  }

  // ─── ECS live query ───────────────────────────────────────────────────────

  /**
   * Create a live query that reflects the current ECS state on each iteration.
   *
   * The returned `Iterable` re-evaluates matching entities every time it is
   * iterated — no stale cache is exposed to the caller.
   *
   * @param components - Array of component definitions all matched entities must have
   * @param precomputedKey - Optional cache key pre-computed by the Vite transform.
   *   When provided, `normalizeComponentTypesForQuery` is skipped.
   *   Do not pass manually; this parameter is injected by `gwenQueryHoistPlugin`.
   * @returns A live {@link LiveQuery} of {@link EntityAccessor} objects
   */
  createLiveQuery<const C extends readonly ComponentDef[]>(
    components: C,
    _precomputedKey?: string,
  ): LiveQuery<EntityAccessor<C>> {
    return this._entities.createLiveQuery(components, _precomputedKey);
  }

  // ─── Internal WASM bridge accessors ───────────────────────────────────────

  getPlacementBridge(): PlacementBridge {
    const bridge = this._bridge.engine();
    if (!bridge) {
      throw new GwenError(
        CoreErrorCodes.WASM_NOT_INITIALIZED,
        "[GWEN] getPlacementBridge() called before WASM is initialised. " +
          "Await bridge.init() before calling placement composables.",
      );
    }
    // boundary: WASM bridge object is an untyped export bag. PlacementBridge is its typed view.
    return bridge as unknown as PlacementBridge;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  get deltaTime(): number {
    return this._stats.deltaTime;
  }
  /** Uncapped, unscaled wall-frame duration in seconds. */
  get rawFrameTime(): number {
    return this._stats.rawFrameTime;
  }
  /** Completed frames. In fixed mode, one per simulation step. */
  get frameCount(): number {
    return this._stats.frameCount;
  }
  /** Smoothed frames per second from the raw wall-frame duration, not the scaled simulation dt. */
  getFPS(): number {
    return this._stats.fps;
  }
  getStats(): EngineStats {
    return this._stats.snapshot();
  }
}

// #endregion
