/**
 * Collaborators built once, in dependency order, before the first frame.
 * @internal
 */

import { createHooks, type Hookable } from "hookable";
import type { IGwenLogger } from "@gwenjs/schema";
import type { GwenRuntimeHooks } from "./runtime-hooks";
import { stringPoolFor } from "../utils/string-pool";
import { createLogger } from "../logger/index";
import { WasmBridgeImpl } from "./wasm-bridge";
import { EngineMemory } from "./engine-memory.js";
import type { EntityId } from "./engine-api";
import { createErrorBus } from "./error-bus.js";
import { bindFailureReporter, isIsolated } from "./error-isolation.js";
import { ScopedHooksTracker } from "./hook-tracker.js";
import { PluginRegistry } from "./plugin-registry.js";
import { ServiceContainer } from "./service-container.js";
import { EngineEntities } from "./engine-entities.js";
import { EngineStatsRecorder } from "./engine-stats.js";
import { EngineStateMachine } from "./engine-state.js";
import { EngineErrorPolicy } from "./engine-error-policy.js";
import { EngineLoop } from "./engine-loop.js";
import { bindEngineOnHooks, emitEntityDestroy } from "./hook-dispatch.js";
import { rememberEngineInternals } from "./engine-internals.js";
import { WasmModuleRunner } from "./wasm-module-runner.js";
import type { GwenEngine, GwenEngineOptions } from "./engine-types.js";
import { DisposableRegistry, createDisposable } from "../disposable.js";
import type { ComponentType } from "../types";

export abstract class EngineCollaborators {
  readonly maxEntities: number;
  readonly targetFPS: number;
  readonly maxDeltaSeconds: number;
  timeScale: number = 1;
  readonly variant: "light" | "physics2d" | "physics3d";
  readonly debug: boolean;
  readonly logger: IGwenLogger;
  physicsHz: number;
  maxCatchupSteps: number;

  readonly disposables = new DisposableRegistry();

  protected readonly _pluginRegistry: PluginRegistry;
  protected readonly _serviceContainer: ServiceContainer;
  protected readonly _stateMachine: EngineStateMachine;
  /** Error policy for this engine. @internal */
  protected readonly _policy: EngineErrorPolicy;
  protected readonly _memory: EngineMemory;
  protected readonly _wasmRunner: WasmModuleRunner;
  protected readonly _stats: EngineStatsRecorder;
  protected readonly _loop: EngineLoop;
  readonly hooks: Hookable<GwenRuntimeHooks> = createHooks<GwenRuntimeHooks>();
  /** @internal */ readonly _bridge: WasmBridgeImpl;
  protected readonly _entities: EngineEntities;

  /**
   * The facade returns this engine.
   * Called from this constructor, so it must not read subclass fields.
   */
  protected abstract asEngine(): GwenEngine;

  abstract getOrRegisterComponent(type: ComponentType): number;

  constructor(opts: GwenEngineOptions) {
    const engine = this.asEngine();
    this._bridge = opts._bridge ?? new WasmBridgeImpl();
    this.maxEntities = opts.maxEntities ?? 10_000;
    this.targetFPS = opts.targetFPS ?? 60;
    this.maxDeltaSeconds = opts.maxDeltaSeconds ?? 0.1;
    this.variant = opts.variant ?? "light";
    this.debug = opts.debug ?? false;
    this.physicsHz = opts.physicsHz ?? 0;
    this.maxCatchupSteps = opts.maxCatchupSteps ?? 2;
    this._stats = new EngineStatsRecorder({
      targetFPS: this.targetFPS,
      debug: this.debug,
      entityCount: () => this._entities.count(),
      linearMemory: () => {
        const readMemory = this._bridge.getLinearMemory;
        if (typeof readMemory !== "function") return null;
        return readMemory.call(this._bridge);
      },
      phaseMs: () => this._loop.lastPhaseMs,
    });
    this.logger = createLogger("gwen:core", this.debug, () => this._stats.frameCount);
    // `provide` calls `assert` immediately. The machine exists before the first one.
    this._stateMachine = new EngineStateMachine({
      hooks: this.hooks,
      logger: this.logger,
      cancelFrame: () => this._loop.cancel(),
    });
    this._serviceContainer = new ServiceContainer({
      assertState: (method) => this._stateMachine.assert(method),
    });
    this._serviceContainer.provide("wasm:bridge", this._bridge);
    this._serviceContainer.provide("logger", this.logger);
    const reportDestroyFailure = (id: EntityId, error: unknown): void => {
      this._policy.reportEntityDestroyFailure(id, error);
    };
    this._entities = new EngineEntities({
      maxEntities: this.maxEntities,
      assertState: (method) => this._stateMachine.assert(method),
      emitDestroy: (id) => emitEntityDestroy(engine, this.hooks, reportDestroyFailure, id),
      engine,
      bridge: this._bridge,
    });
    this.hooks.hook("engine:stop", () => {
      this._entities.releaseQueries();
    });

    const errorBus = opts.errorBus ?? createErrorBus({ logger: this.logger });
    this._policy = new EngineErrorPolicy({
      bus: errorBus,
      hooks: this.hooks,
      logger: this.logger,
      state: this._stateMachine,
      frame: () => this._stats.frameCount,
      debug: this.debug,
      owner: this,
      disposables: this.disposables,
      pluginNamed: (name) => this._pluginRegistry.pluginNamed(name),
      bridge: this._bridge,
    });
    this._serviceContainer.provide("errors", errorBus);
    this._pluginRegistry = new PluginRegistry({
      hooks: this.hooks,
      tracker: new ScopedHooksTracker(),
      errors: errorBus,
      assertState: (method) => this._stateMachine.assertPlugin(method),
      logger: this.logger,
      debug: this.debug,
      remember: (proxy) => this._rememberInternals(proxy),
      frame: () => this._stats.frameCount,
      reportSetup: (plugin, error) => this._policy.reportSetupError(plugin, error),
      reportTeardown: (plugin, error) => this._policy.reportTeardown(plugin, error),
      dropIsolation: (name) => this._policy.dropIsolation(name),
    });
    bindFailureReporter(this, (error, target, hook) => {
      this._policy.reportCaught(error, hook, { target });
    });
    this._memory = new EngineMemory(this._bridge, errorBus);
    this._serviceContainer.provide("memory", this._memory);
    this._wasmRunner = new WasmModuleRunner({
      bridge: this._bridge,
      maxEntities: this.maxEntities,
      disposables: this.disposables,
      memory: this._memory,
      assertState: (method) => this._stateMachine.assert(method),
      isFaulted: () => this._stateMachine.isFaulted(),
      isIsolated: (id) => isIsolated(this, id),
      frame: () => this._stats.frameCount,
      reportCaught: (err, hook, forced) => this._policy.reportCaught(err, hook, forced),
      publish: (event) => this._policy.publish(event),
    });
    this.disposables.add(
      "engine:memory",
      createDisposable(() => {
        this._memory.disposeAll();
      }),
    );
    this._loop = new EngineLoop({
      owner: engine,
      config: this,
      hooks: this.hooks,
      stats: this._stats,
      modules: this._wasmRunner,
      bridge: this._bridge,
      memory: this._memory,
      policy: this._policy,
      state: this._stateMachine,
      logger: this.logger,
    });
    this._policy.attach();
    this._rememberInternals(engine);
    bindEngineOnHooks(engine, this.hooks);
    stringPoolFor(engine);
  }

  /**
   * Slot flag used by actor pools. Not a component and not on {@link GwenEngine}.
   * Returns false when `id` is not alive, without changing state.
   * @internal
   */
  _setEntityDormant(id: EntityId, dormant: boolean): boolean {
    return this._entities.setDormant(id, dormant);
  }

  private _rememberInternals(key: object): void {
    rememberEngineInternals(key, {
      setDormant: (id, dormant) => this._setEntityDormant(id, dormant),
      queryIds: (components) => this._entities.resolveIds(components),
    });
  }
}
