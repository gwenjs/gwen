import type { Hookable } from "hookable";
import {
  GWEN_PLUGIN_KEYS,
  GWEN_PLUGIN_LIFECYCLE_HOOKS,
  type ForbiddenPluginKey,
  type GwenPluginRequirement,
  type IGwenLogger,
} from "@gwenjs/schema";
import { withCleanup } from "../cleanup-context.js";
import { GwenScope } from "../context/scope.js";
import {
  CoreErrorCodes,
  GwenPluginDependencyError,
  GwenPluginShapeError,
} from "./engine-errors.js";
import { popEngine, pushEngine } from "./engine-local.js";
import type { ServiceChangeNotice } from "./service-change.js";
import type { ServiceWriteResult } from "./service-container.js";
import type { EngineErrorBus, GwenEngine, GwenPlugin } from "./engine-types.js";
import {
  beginPluginSetup,
  currentPluginSetupTarget,
  endPluginSetup,
  guardHandler,
} from "./error-isolation.js";
import { ScopedHooksTracker } from "./hook-tracker.js";
import type { GwenRuntimeHooks } from "./runtime-hooks.js";

/**
 * Collaborators `use` / `unuse` need from the facade.
 * `debug` is readonly on the engine, so the boolean is read once here.
 * `hooks`, `logger`, and `errors` are the live objects, not copies.
 */
export interface PluginRegistryDeps {
  hooks: Hookable<GwenRuntimeHooks>;
  tracker: ScopedHooksTracker;
  errors: EngineErrorBus;
  assertState: (method: "use" | "unuse") => void;
  logger: IGwenLogger;
  debug: boolean;
  remember: (proxy: GwenEngine) => void;
  frame: () => number;
  reportSetup: (plugin: GwenPlugin, error: unknown) => void;
  reportTeardown: (plugin: GwenPlugin, error: unknown) => void;
  dropIsolation: (name: string) => void;
  /** True when the service map already holds `key`. Engine-owned keys count. */
  hasService: (key: string) => boolean;
  /**
   * Remove `key` only while the map still holds `expected`.
   * Engine-owned keys stay. This must not check engine state.
   */
  deleteService: (key: string, expected: unknown) => boolean;
  /** Classify and store. Does not announce. Same state gate as `ServiceContainer.provide`. */
  writeService: (key: string, value: unknown) => ServiceWriteResult;
  /** Isolated `service:provided` / `service:removed`. */
  emitServiceChange: (notice: ServiceChangeNotice) => void;
}

interface QueuedProvide {
  readonly key: string;
  readonly value: unknown;
  readonly previous: unknown;
  readonly previousOwner: string | undefined;
  readonly overwrite: boolean;
}

type PluginRegistryReceiver = Pick<GwenEngine, "hooks">;

function receiverEngine(receiver: PluginRegistryReceiver): GwenEngine {
  return receiver as GwenEngine;
}

/**
 * Plugin list, scoped hook capture, and use/unuse.
 * @internal
 */
export class PluginRegistry {
  private readonly _plugins: GwenPlugin[] = [];
  private readonly _pluginNames = new Set<string>();
  /** In-flight `use()` calls. A name here is not installed yet. */
  private readonly _pending = new Map<string, Promise<void>>();
  /** In-flight removals. A second `_remove` for that name awaits this promise. */
  private readonly _removing = new Map<string, Promise<void>>();
  /** Dispose functions collected by withCleanup() during plugin setup — keyed by plugin name. */
  private readonly _pluginCleanups = new Map<string, () => void>();
  /** Plugin name → scope for that plugin's setup and lifetime. */
  private readonly _scopes = new Map<string, GwenScope>();
  /** Plugin name → service key → value that plugin's setup proxy provided. */
  private readonly _owned = new Map<string, Map<string, unknown>>();
  /** Provides made during `setup`, flushed after the name is stored. */
  private readonly _queued = new Map<string, QueuedProvide[]>();
  /** First value a not-yet-installed plugin replaced. Restored if `setup` throws. */
  private readonly _rollback = new Map<string, Map<string, { readonly previous: unknown }>>();

  constructor(private readonly deps: PluginRegistryDeps) {}

  pluginNamed(name: string): GwenPlugin | undefined {
    return this._plugins.find((plugin) => plugin.name === name);
  }

  clearHooks(): void {
    this.deps.tracker.clearAll(this.deps.hooks);
  }

  // Not `async`: callers must receive `_install`'s promise unchanged.
  use(plugin: GwenPlugin, receiver: PluginRegistryReceiver): Promise<void> {
    try {
      this.deps.assertState("use");
      this._assertShape(plugin);
      if (this._pluginNames.has(plugin.name)) {
        this._warnDuplicate(plugin.name);
        return Promise.resolve();
      }
      const inFlight = this._pending.get(plugin.name);
      if (inFlight !== undefined) {
        this._warnDuplicate(plugin.name);
        return inFlight;
      }

      const missing = this._missingRequirements(plugin);
      if (missing.length > 0) {
        return Promise.reject(
          new GwenPluginDependencyError({
            code: CoreErrorCodes.PLUGIN_DEPENDENCY_MISSING,
            plugin: plugin.name,
            missing,
          }),
        );
      }

      const run = this._install(plugin, receiver);
      this._pending.set(plugin.name, run);
      return run;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Lifecycle keys throw. Other own keys warn in dev when debug is on. */
  private _assertShape(plugin: GwenPlugin): void {
    const found = Object.keys(plugin).filter((key): key is ForbiddenPluginKey =>
      Object.prototype.hasOwnProperty.call(GWEN_PLUGIN_LIFECYCLE_HOOKS, key),
    );
    if (found.length > 0) throw new GwenPluginShapeError(plugin.name, found);
    if (__GWEN_DEV__ && this.deps.debug) {
      const allowed: ReadonlySet<string> = new Set(GWEN_PLUGIN_KEYS);
      for (const key of Object.keys(plugin)) {
        if (allowed.has(key) || key.startsWith("_")) continue;
        this.deps.logger.warn(`[GWEN] plugin "${plugin.name}": unknown key "${key}" is ignored.`);
      }
    }
  }

  private _missingRequirements(plugin: GwenPlugin): GwenPluginRequirement[] {
    const requires = plugin.requires;
    const plugins = requires?.plugins ?? [];
    const services = requires?.services ?? [];
    return [
      ...plugins
        .filter((name) => !this._pluginNames.has(name))
        .map((name) => ({ kind: "plugin" as const, name })),
      ...services
        .filter((name) => !this.deps.hasService(name))
        .map((name) => ({ kind: "service" as const, name })),
    ];
  }

  private _warnDuplicate(name: string): void {
    if (__GWEN_DEV__ && this.deps.debug) {
      this.deps.logger.warn(
        `[GWEN] plugin "${name}" is already installed; duplicate use() ignored.`,
      );
    }
  }

  private _install(plugin: GwenPlugin, receiver: PluginRegistryReceiver): Promise<void> {
    const run = this._runInstall(plugin, receiver);
    const drop = (): void => {
      this._pending.delete(plugin.name);
    };
    // A use() queued earlier in this tick still sees the settled run for one microtask.
    // Side reaction only. Wrapping `run` would settle one microtask later.
    void run.then(drop, drop);
    return run;
  }

  private async _runInstall(plugin: GwenPlugin, receiver: PluginRegistryReceiver): Promise<void> {
    const scopedHooks = this._createScopedHooks(plugin.name, receiver);
    const engineWithScopedHooks = this._withScopedHooks(plugin.name, scopedHooks, receiver);
    // Real receiver: the object useEngine() returns during setup, and the one
    // bindFailureReporter is bound to. useHook() guards against that object.
    // id is the plugin name because GwenScope.hook builds the isolation target
    // from meta, and a plugin target is looked up by target.id.
    // scope.engine.provide(...) is not attributed to the plugin the way
    // engine.provide on the setup parameter is. Nothing here relies on that.
    const scope = new GwenScope(receiverEngine(receiver), {
      type: "plugin",
      id: plugin.name,
      name: plugin.name,
    });
    this._scopes.set(plugin.name, scope);

    try {
      // Engine context outermost, then the plugin scope, then cleanup capture.
      // Nesting another engine is allowed (no "Context conflict").
      // Attribution and the scope cover only the synchronous part of setup.
      let setupResult: void | Promise<void> | undefined;
      const previousSetup = beginPluginSetup(plugin);
      const previousEngine = pushEngine(receiverEngine(receiver));
      try {
        try {
          const [, dispose] = scope.run(() =>
            withCleanup(() => {
              setupResult = plugin.setup(receiverEngine(engineWithScopedHooks));
            }),
          );
          this._pluginCleanups.set(plugin.name, dispose);
        } finally {
          popEngine(receiverEngine(receiver), previousEngine);
        }
      } finally {
        endPluginSetup(previousSetup);
      }
      if (setupResult instanceof Promise) await setupResult;
    } catch (err) {
      // Roll back owned services, the plugin scope, onCleanup callbacks, and scoped hooks.
      // A created key is deleted. A replaced key is restored. Nothing is announced.
      this._queued.delete(plugin.name);
      this._dropOwned(plugin.name);
      this._scopes.delete(plugin.name);
      // A throwing onCleanup is reported. It must not replace the setup error
      // or skip the rest of this rollback.
      try {
        scope.dispose();
      } catch (cleanupError: unknown) {
        this.deps.reportTeardown(plugin, cleanupError);
      }
      this._pluginCleanups.get(plugin.name)?.();
      this._pluginCleanups.delete(plugin.name);
      this.deps.tracker.removeAll(plugin.name, receiver.hooks);
      this.deps.reportSetup(plugin, err);
      throw err;
    }

    this._plugins.push(plugin);
    this._pluginNames.add(plugin.name);
    this._rollback.delete(plugin.name);
    this._flushProvides(plugin.name);
    await receiver.hooks.callHook("plugin:registered", plugin.name);
    if (this.deps.debug) {
      this.deps.logger.debug(`plugin registered: ${plugin.name}`);
    }
  }

  async unuse(name: string, receiver: PluginRegistryReceiver): Promise<void> {
    this.deps.assertState("unuse");
    const plugin = this._plugins.find((item) => item.name === name);
    if (plugin === undefined) return;
    const dependents = this._dependentsOf(name);
    if (dependents.length > 0) {
      throw new GwenPluginDependencyError({
        code: CoreErrorCodes.PLUGIN_IN_USE,
        plugin: name,
        dependents,
      });
    }
    await this._remove(plugin, receiver, "unuse");
  }

  /** Last installed first. No state check and no dependency check: `stop()` calls this. */
  async teardownAll(receiver: PluginRegistryReceiver): Promise<void> {
    for (const plugin of [...this._plugins].reverse()) {
      await this._remove(plugin, receiver, "stop");
    }
  }

  /** Installed plugins, in install order, that still require `name` or one of its services. */
  private _dependentsOf(name: string): string[] {
    const owned = this._owned.get(name);
    const dependents: string[] = [];
    for (const plugin of this._plugins) {
      const requires = plugin.requires;
      const needsPlugin = (requires?.plugins ?? []).includes(name);
      const needsService =
        owned !== undefined && (requires?.services ?? []).some((key) => owned.has(key));
      if (needsPlugin || needsService) dependents.push(plugin.name);
    }
    return dependents;
  }

  /**
   * One removal path for `unuse` and `stop`.
   * A second call for the same name awaits the in-flight promise.
   * The promise is stored before the body runs, so `stop()` waits for an in-flight `unuse`.
   * A `teardown` that awaits `unuse` of its own name waits on this same promise.
   */
  private _remove(
    plugin: GwenPlugin,
    receiver: PluginRegistryReceiver,
    reason: "unuse" | "stop",
  ): Promise<void> {
    const name = plugin.name;
    const inFlight = this._removing.get(name);
    if (inFlight !== undefined) return inFlight;

    let resolveRun: () => void = () => {};
    let rejectRun: (error: unknown) => void = () => {};
    const run = new Promise<void>((resolve, reject) => {
      resolveRun = resolve;
      rejectRun = reject;
    });
    this._removing.set(name, run);
    void this._finishRemove(plugin, receiver, reason).then(
      () => {
        this._removing.delete(name);
        resolveRun();
      },
      (error: unknown) => {
        this._removing.delete(name);
        rejectRun(error);
      },
    );
    return run;
  }

  /**
   * Services go first, then the setup disposer, then `teardown`.
   * The disposer is inside the `try`: a throwing `onCleanup` is reported and
   * `teardown` still runs. Hook removal stays in `finally`.
   */
  private async _finishRemove(
    plugin: GwenPlugin,
    receiver: PluginRegistryReceiver,
    reason: "unuse" | "stop",
  ): Promise<void> {
    const name = plugin.name;
    this._dropOwned(name, reason);
    const dispose = this._pluginCleanups.get(name);
    this._pluginCleanups.delete(name);
    const scope = this._scopes.get(name);
    this._scopes.delete(name);
    const previousEngine = pushEngine(receiverEngine(receiver));
    try {
      try {
        scope?.dispose();
        dispose?.();
      } catch (cleanupError: unknown) {
        this.deps.reportTeardown(plugin, cleanupError);
      }
      await plugin.teardown?.();
    } catch (err) {
      this.deps.reportTeardown(plugin, err);
    } finally {
      popEngine(receiverEngine(receiver), previousEngine);
      this.deps.tracker.removeAll(name, receiver.hooks);
      this.deps.dropIsolation(name);
      const idx = this._plugins.indexOf(plugin);
      if (idx !== -1) this._plugins.splice(idx, 1);
      this._pluginNames.delete(name);
    }
  }

  /**
   * Reverse provide order. Shared by a failed `setup` and removal step (0).
   * Emits `service:removed` only when `delete` returns true and a reason is set.
   * The key is already gone. `value` is the value that was removed.
   */
  private _dropOwned(name: string, reason?: "unuse" | "stop"): void {
    const owned = this._owned.get(name);
    const rollback = this._rollback.get(name);
    if (owned !== undefined) {
      for (const key of [...owned.keys()].reverse()) {
        const value = owned.get(key);
        const undo = rollback?.get(key);
        if (reason === undefined && undo !== undefined) {
          this.deps.writeService(key, undo.previous);
          continue;
        }
        const removed = this.deps.deleteService(key, value);
        if (removed && reason !== undefined) {
          this.deps.emitServiceChange({
            hook: "service:removed",
            key,
            value,
            owner: name,
            reason,
          });
        }
      }
    }
    this._owned.delete(name);
    this._rollback.delete(name);
    this._queued.delete(name);
  }

  private _flushProvides(name: string): void {
    const queued = this._queued.get(name);
    this._queued.delete(name);
    if (queued === undefined) return;
    for (const item of queued) this._emitProvide(name, item);
  }

  /** `service:removed` names the owner of the value that was replaced. */
  private _emitProvide(name: string, item: QueuedProvide): void {
    if (item.overwrite && item.previousOwner !== undefined && item.previousOwner !== name) {
      this._owned.get(item.previousOwner)?.delete(item.key);
    }
    if (item.overwrite) {
      this.deps.emitServiceChange({
        hook: "service:removed",
        key: item.key,
        value: item.previous,
        owner: item.previousOwner,
        reason: "overwrite",
      });
    }
    this.deps.emitServiceChange({
      hook: "service:provided",
      key: item.key,
      value: item.value,
      owner: name,
      reason: item.overwrite ? "overwrite" : "install",
    });
  }

  /** Who held `key` before this plugin's write. Self wins when it already did. */
  private _ownerOf(self: string, key: string): string | undefined {
    if (this._owned.get(self)?.has(key)) return self;
    for (const [owner, keys] of this._owned) {
      if (owner !== self && keys.has(key)) return owner;
    }
    return undefined;
  }

  /** `same` does not take ownership. Engine-owned keys are stored and not announced. */
  private _recordProvide(name: string, key: string, value: unknown): void {
    const write = this.deps.writeService(key, value);
    if (write.kind === "same") return;
    const previousOwner = this._ownerOf(name, key);
    const installed = this._pluginNames.has(name);
    if (!installed && write.kind === "overwrite" && !this._owned.get(name)?.has(key)) {
      let roll = this._rollback.get(name);
      if (roll === undefined) {
        roll = new Map<string, { readonly previous: unknown }>();
        this._rollback.set(name, roll);
      }
      roll.set(key, { previous: write.previous });
    }
    this._ownedFor(name).set(key, value);
    if (write.kind !== "created" && write.kind !== "overwrite") return;
    const item: QueuedProvide = {
      key,
      value,
      previous: write.kind === "overwrite" ? write.previous : undefined,
      previousOwner: write.kind === "overwrite" ? previousOwner : undefined,
      overwrite: write.kind === "overwrite",
    };
    if (this._pluginNames.has(name)) {
      this._emitProvide(name, item);
      return;
    }
    let queued = this._queued.get(name);
    if (queued === undefined) {
      queued = [];
      this._queued.set(name, queued);
    }
    queued.push(item);
  }

  //
  // RFC-001 (Plugin Lifecycle):
  // `engineWithScopedHooks` (a Proxy of the receiver) is what `plugin.setup()` sees.
  // This proxy captures the plugin's name. Any hook registered via `engine.hooks.hook()`
  // by this plugin is trapped and tracked by `ScopedHooksTracker` using this captured name.
  //
  // CRITICAL async factory lifetime warning:
  // If `plugin.setup()` is async, or returning an async factory, the Proxy
  // instance (`engineWithScopedHooks`) is bound to the closure at invocation time.
  // Avoid leaking this proxy outside setup; subsequent system/feature
  // declarations should ideally use the actual resolved engine from context.
  //

  private _createScopedHooks(
    pluginName: string,
    receiver: PluginRegistryReceiver,
  ): Hookable<GwenRuntimeHooks> {
    const tracker = this.deps.tracker;
    const realHooks = receiver.hooks;
    const errors = this.deps.errors;
    const frame = this.deps.frame;
    // A memory-grow failure keeps the plugin name and does not isolate it.
    // Later hooks in the same frame, including this plugin, still run.
    const emitGrowError = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      errors.emit({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: `[${pluginName}] engine:memory-grow threw: ${message}`,
        source: pluginName,
        error,
        context: { frame: frame() },
      });
    };
    return new Proxy(realHooks, {
      get(target, prop) {
        if (prop === "hook") {
          return (event: string, fn: (...args: unknown[]) => unknown) => {
            const setup = currentPluginSetupTarget();
            const registered =
              event === "engine:memory-grow"
                ? async (info: unknown) => {
                    try {
                      await fn(info);
                    } catch (error: unknown) {
                      emitGrowError(error);
                    }
                  }
                : setup && setup.id === pluginName
                  ? guardHandler(fn, setup, event, receiver)
                  : fn;
            tracker.track(pluginName, event, registered);
            const register = Reflect.get(target, "hook");
            if (typeof register !== "function") return undefined;
            return Reflect.apply(register, target, [event, registered]);
          };
        }
        return Reflect.get(target, prop);
      },
    });
  }

  private _ownedFor(name: string): Map<string, unknown> {
    const existing = this._owned.get(name);
    if (existing !== undefined) return existing;
    const owned = new Map<string, unknown>();
    this._owned.set(name, owned);
    return owned;
  }

  private _withScopedHooks(
    pluginName: string,
    scopedHooks: Hookable<GwenRuntimeHooks>,
    receiver: PluginRegistryReceiver,
  ): PluginRegistryReceiver {
    const proxy = new Proxy(receiver, {
      get: (target, prop) => {
        if (prop === "hooks") return scopedHooks;
        // A provide through this proxy is queued. A provide on the real engine is not.
        if (prop === "provide") {
          return (key: string, value: unknown): void => {
            this._recordProvide(pluginName, key, value);
          };
        }
        return Reflect.get(target, prop);
      },
    });
    // setup() receives this proxy. Pool dormancy looks the proxy up, not the class.
    this.deps.remember(receiverEngine(proxy));
    return proxy;
  }
}
