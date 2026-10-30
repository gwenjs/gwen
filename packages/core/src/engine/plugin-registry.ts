import type { Hookable } from "hookable";
import {
  GWEN_PLUGIN_KEYS,
  GWEN_PLUGIN_LIFECYCLE_HOOKS,
  type ForbiddenPluginKey,
  type GwenPluginRequirement,
  type IGwenLogger,
} from "@gwenjs/schema";
import { withCleanup } from "../cleanup-context.js";
import {
  CoreErrorCodes,
  GwenPluginDependencyError,
  GwenPluginShapeError,
} from "./engine-errors.js";
import { popEngine, pushEngine } from "./engine-local.js";
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
  /** Plugin name → service key → value that plugin's setup proxy provided. */
  private readonly _owned = new Map<string, Map<string, unknown>>();

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

    try {
      // Run the synchronous part of setup with this engine current, then restore
      // whoever was current. Nesting another engine is allowed (no "Context conflict").
      // Attribution covers only the synchronous part of setup.
      let setupResult: void | Promise<void> | undefined;
      const previousSetup = beginPluginSetup(plugin);
      const previousEngine = pushEngine(receiverEngine(receiver));
      try {
        try {
          const [, dispose] = withCleanup(() => {
            setupResult = plugin.setup(receiverEngine(engineWithScopedHooks));
          });
          this._pluginCleanups.set(plugin.name, dispose);
        } finally {
          popEngine(receiverEngine(receiver), previousEngine);
        }
      } finally {
        endPluginSetup(previousSetup);
      }
      if (setupResult instanceof Promise) await setupResult;
    } catch (err) {
      // Roll back owned services, onCleanup callbacks, and scoped hooks.
      // A provide before the throw must not stay in the container or in `_owned`.
      this._dropOwned(plugin.name);
      this._pluginCleanups.get(plugin.name)?.();
      this._pluginCleanups.delete(plugin.name);
      this.deps.tracker.removeAll(plugin.name, receiver.hooks);
      this.deps.reportSetup(plugin, err);
      throw err;
    }

    this._plugins.push(plugin);
    this._pluginNames.add(plugin.name);
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
    await this._remove(plugin, receiver);
  }

  /** Last installed first. No state check and no dependency check: `stop()` calls this. */
  async teardownAll(receiver: PluginRegistryReceiver): Promise<void> {
    for (const plugin of [...this._plugins].reverse()) {
      await this._remove(plugin, receiver);
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
  private _remove(plugin: GwenPlugin, receiver: PluginRegistryReceiver): Promise<void> {
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
    void this._finishRemove(plugin, receiver).then(
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
  private async _finishRemove(plugin: GwenPlugin, receiver: PluginRegistryReceiver): Promise<void> {
    const name = plugin.name;
    this._dropOwned(name);
    const dispose = this._pluginCleanups.get(name);
    this._pluginCleanups.delete(name);
    const previousEngine = pushEngine(receiverEngine(receiver));
    try {
      try {
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

  /** Reverse provide order. Shared by a failed `setup` and removal step (0). */
  private _dropOwned(name: string): void {
    const owned = this._owned.get(name);
    if (owned !== undefined) {
      for (const key of [...owned.keys()].reverse()) {
        this.deps.deleteService(key, owned.get(key));
      }
    }
    this._owned.delete(name);
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
    const owned = this._ownedFor(pluginName);
    const proxy = new Proxy(receiver, {
      get(target, prop) {
        if (prop === "hooks") return scopedHooks;
        // A provide through this proxy is owned. A provide on the real engine is not.
        if (prop === "provide") {
          return (key: string, value: unknown): void => {
            const provide: unknown = Reflect.get(target, "provide");
            if (typeof provide !== "function") return;
            Reflect.apply(provide, target, [key, value]);
            owned.set(key, value);
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
