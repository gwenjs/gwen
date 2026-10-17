import type { Hookable } from "hookable";
import type {
  GwenErrorPayload as BusErrorPayload,
  GwenErrorTarget,
  GwenPlugin,
  IGwenLogger,
  PluginErrorContext,
} from "@gwenjs/schema";
import type { EntityId } from "./engine-api.js";
import type { EngineErrorBus } from "./engine-types.js";
import type { EngineErrorPayload, GwenRuntimeHooks } from "./runtime-hooks.js";
import type { EngineStateMachine } from "./engine-state.js";
import { CoreErrorCodes, GwenWasmError, GwenWasmPanicError } from "./engine-errors.js";
import {
  forgetTarget,
  isolateTarget,
  isThenable,
  listIsolated,
  phaseForHook,
  clearIsolated,
} from "./error-isolation.js";
import { poisonWasmBridge } from "./wasm-bridge.js";
import { createDisposable, DisposableRegistry } from "../disposable.js";

/**
 * `owner` is the engine object. Isolation and `guardHandler` are keyed on it.
 * `disposables` is the engine registry so `stop()` still unsubscribes in its LIFO order.
 * `pluginNamed` and `bridge` are read when a report runs, not at construction.
 */
export interface EngineErrorPolicyDeps {
  bus: EngineErrorBus;
  hooks: Hookable<GwenRuntimeHooks>;
  logger: IGwenLogger;
  state: EngineStateMachine;
  frame: () => number;
  debug: boolean;
  owner: object;
  disposables: DisposableRegistry;
  pluginNamed: (name: string) => GwenPlugin | undefined;
  bridge: object;
}

/**
 * Isolation, the fatal transition, and the error-bus bridge.
 * @internal
 */
export class EngineErrorPolicy {
  private _errorOnAttached = false;
  private _errorFatalAttached = false;
  private _errorInstallAttached = false;
  private _emitBridgeActive = false;
  /** Set when `emit` cannot be wrapped. `engine:error` then fires from `on`. */
  private _engineErrorFromOn = false;
  /** One core trap is published. A later poisoned-bridge rethrow is not a second panic. */
  private _wasmPanicPublished = false;
  private _releaseOn: (() => void) | undefined;
  private _releaseFatal: (() => void) | undefined;
  private _releaseInstall: (() => void) | undefined;
  private _releaseEmit: (() => void) | undefined;

  constructor(private readonly deps: EngineErrorPolicyDeps) {}

  get bus(): EngineErrorBus {
    return this.deps.bus;
  }

  isolated(): readonly GwenErrorTarget[] {
    return listIsolated(this.deps.owner);
  }

  reenable(id: string): boolean {
    return forgetTarget(this.deps.owner, id);
  }

  clearIsolated(): void {
    clearIsolated(this.deps.owner);
  }

  /** Bus uninstall and the `on` / `onFatal` / `install` / `emit` releases. Idempotent. */
  dispose(): void {
    this._releaseEmit?.();
    this._releaseInstall?.();
    this._releaseFatal?.();
    this._releaseOn?.();
  }

  /** Isolation and the fatal transition. Runs even when a custom bus does not call `on`. */
  publish(event: BusErrorPayload): void {
    this._noteIsolation(event);
    if (event.level === "fatal") {
      this.deps.state.enterFaulted(
        event.code === CoreErrorCodes.WASM_PANIC ? "WASM_PANIC" : "FATAL_ERROR",
      );
    }
    this.emit(event);
  }

  emit(event: BusErrorPayload): void {
    try {
      this.deps.bus.emit(event);
    } catch (error) {
      this._logHandlerFailed(error);
    }
  }

  attach(): void {
    const bus = this.deps.bus;
    if (!this._errorOnAttached) {
      const unsubscribe = bus.on((event) => {
        this._applyBusEvent(event);
      });
      this._errorOnAttached = true;
      if (typeof unsubscribe === "function") {
        const release = (): void => {
          this._releaseOn = undefined;
          this._errorOnAttached = false;
          unsubscribe();
        };
        this._releaseOn = release;
        this.deps.disposables.add("errors:on", createDisposable(release));
      }
    }
    if (!this._errorFatalAttached) {
      const unsubscribeFatal = bus.onFatal(() => {
        this.deps.state.enterFaulted("FATAL_ERROR");
      });
      this._errorFatalAttached = true;
      if (typeof unsubscribeFatal === "function") {
        const release = (): void => {
          this._releaseFatal = undefined;
          this._errorFatalAttached = false;
          unsubscribeFatal();
        };
        this._releaseFatal = release;
        this.deps.disposables.add("errors:onFatal", createDisposable(release));
      }
    }
    if (!this._errorInstallAttached) {
      const uninstall = bus.install?.();
      if (typeof uninstall === "function") {
        this._errorInstallAttached = true;
        const release = (): void => {
          this._releaseInstall = undefined;
          this._errorInstallAttached = false;
          uninstall();
        };
        this._releaseInstall = release;
        this.deps.disposables.add("errors:install", createDisposable(release));
      }
    }
    this._bridgeErrorEmit();
  }

  handleFrameLoopError(err: unknown): void {
    if (err instanceof WebAssembly.RuntimeError) {
      poisonWasmBridge(this.deps.bridge, err);
    }
    try {
      this.reportCaught(err, "frame");
    } catch (handlerError) {
      this._logHandlerFailed(handlerError);
    }
  }

  reportSetupError(plugin: GwenPlugin, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const isTrap = err instanceof WebAssembly.RuntimeError;
    if (!isTrap && this._consultRecover(plugin, err, "setup")) return;
    this.publish({
      level: "error",
      code: isTrap ? CoreErrorCodes.WASM_PANIC : CoreErrorCodes.PLUGIN_SETUP_ERROR,
      message: `[${plugin.name}] setup failed: ${message}`,
      source: plugin.name,
      error: err,
      target: { kind: "plugin", id: plugin.name, name: plugin.name },
      context: { frame: this.deps.frame(), phase: "setup", hook: "setup" },
    });
  }

  reportTeardown(plugin: GwenPlugin, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const isTrap = err instanceof WebAssembly.RuntimeError;
    if (!isTrap && this._consultRecover(plugin, err, "teardown")) return;
    const target: GwenErrorTarget = { kind: "plugin", id: plugin.name, name: plugin.name };
    this.publish({
      level: isTrap ? "fatal" : "error",
      code: isTrap ? CoreErrorCodes.WASM_PANIC : CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message: `[${plugin.name}] teardown threw: ${message}`,
      source: plugin.name,
      error: err,
      target,
      context: { frame: this.deps.frame(), phase: "teardown", hook: "teardown" },
    });
    if (!isTrap) this._firePluginError(plugin.name, "teardown", err, "teardown");
  }

  reportCaught(
    err: unknown,
    hook: string,
    forced?: {
      level?: "error" | "fatal";
      code?: string;
      source?: string;
      message?: string;
      target?: GwenErrorTarget;
    },
  ): void {
    if (forced === undefined && err instanceof WebAssembly.RuntimeError) {
      poisonWasmBridge(this.deps.bridge, err);
    }
    if (
      err instanceof GwenWasmPanicError &&
      err.exportName === undefined &&
      this._wasmPanicPublished
    ) {
      return;
    }
    const message = forced?.message ?? (err instanceof Error ? err.message : String(err));
    const isTrap = err instanceof WebAssembly.RuntimeError || err instanceof GwenWasmPanicError;
    const target = forced?.target;
    const frame = this.deps.frame();

    if (err instanceof GwenWasmError && err.code === CoreErrorCodes.STORAGE_INCONSISTENT) {
      this.publish({
        level: "fatal",
        code: CoreErrorCodes.STORAGE_INCONSISTENT,
        message,
        source: forced?.source ?? "@gwenjs/core",
        error: err,
        ...(target !== undefined ? { target } : {}),
        context: { frame, hook },
      });
      return;
    }

    if (forced?.target?.kind === "wasm-module") {
      this.publish({
        level: "error",
        code: isTrap ? CoreErrorCodes.WASM_PANIC : (forced.code ?? CoreErrorCodes.FRAME_LOOP_ERROR),
        message,
        ...(forced.source !== undefined ? { source: forced.source } : {}),
        error: err,
        target: forced.target,
        context: { frame, hook },
      });
      return;
    }

    if (isTrap || forced?.level === "fatal") {
      if (isTrap) this._wasmPanicPublished = true;
      this.publish({
        level: "fatal",
        code: isTrap
          ? CoreErrorCodes.WASM_PANIC
          : (forced?.code ?? CoreErrorCodes.FRAME_LOOP_ERROR),
        message,
        source:
          forced?.source ?? (err instanceof GwenWasmPanicError ? "gwen_core.wasm" : "@gwenjs/core"),
        error: err,
        ...(target !== undefined ? { target } : {}),
        context: { frame, hook },
      });
      return;
    }

    if (target) {
      const phase = phaseForHook(hook);
      const plugin = this._pluginForTarget(target);
      if (plugin && this._consultRecover(plugin, err, phase, hook)) return;
      const source = target.name;
      this.publish({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: `[${source}] ${phase} threw: ${message}`,
        source,
        error: err,
        target,
        context: { frame, hook, phase },
      });
      if (target.kind === "plugin" || target.kind === "system") {
        const pluginName = target.kind === "plugin" ? target.id : target.name;
        this._firePluginError(pluginName, phase, err, hook);
      }
      return;
    }

    this.publish({
      level: "error",
      code: forced?.code ?? CoreErrorCodes.FRAME_LOOP_ERROR,
      message,
      source: forced?.source ?? "@gwenjs/core",
      error: err,
      context: { frame, hook },
    });
  }

  dropIsolation(name: string): void {
    forgetTarget(this.deps.owner, name);
    for (const target of listIsolated(this.deps.owner)) {
      if (target.id === name || target.name === name) forgetTarget(this.deps.owner, target.id);
    }
  }

  reportEntityDestroyFailure(id: EntityId, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.bus.emit({
      level: "error",
      code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message,
      source: "entity:destroy",
      error,
      context: { entityId: id },
    });
  }

  reportMemoryGrow(error: unknown, frame: number): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deps.bus.emit({
      level: "error",
      code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
      message: `[engine:memory-grow] ${message}`,
      source: "engine:memory-grow",
      error,
      context: { frame },
    });
  }

  private _logHandlerFailed(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.deps.logger.error(`[${CoreErrorCodes.ERROR_HANDLER_FAILED}] ${detail}`, {
      code: CoreErrorCodes.ERROR_HANDLER_FAILED,
    });
  }

  private _catchAsync(result: unknown): void {
    if (!isThenable(result)) return;
    void Promise.resolve(result).catch((error: unknown) => this._logHandlerFailed(error));
  }

  private _noteIsolation(event: BusErrorPayload): void {
    if (event.level !== "error" || !event.target || event.context?.phase === "setup") return;
    if (!isolateTarget(this.deps.owner, event.target)) return;
    // DEV+DEBUG advice. Production builds omit it even when debug is true.
    if (__GWEN_DEV__ && this.deps.debug) {
      const hook = typeof event.context?.hook === "string" ? event.context.hook : "unknown";
      this.deps.logger.warn(
        `[GWEN] ${event.target.kind} "${event.target.name}" isolated after ${event.code} in ${hook}; skipped until engine.reenable("${event.target.id}").`,
      );
    }
  }

  /**
   * `engine:error` runs after every `on` handler.
   * `stop()` drops the wrapper when this engine still owns `emit`.
   * A bus whose `emit` cannot be replaced fires the hook from `on` instead.
   */
  private _bridgeErrorEmit(): void {
    if (this._emitBridgeActive || this._engineErrorFromOn) return;
    const errorBus = this.deps.bus;
    const previous = errorBus.emit;
    let active = true;
    const wrapped = (event: BusErrorPayload): void => {
      if (!active) {
        if (errorBus.emit === wrapped) errorBus.emit = previous;
        previous.call(errorBus, event);
        return;
      }
      try {
        previous.call(errorBus, event);
      } catch (error) {
        this._logHandlerFailed(error);
        return;
      }
      if (event.level === "error" || event.level === "fatal") {
        this._fireEngineErrorHook(event);
      }
    };
    try {
      errorBus.emit = wrapped;
    } catch {
      this._engineErrorFromOn = true;
      return;
    }
    if (errorBus.emit !== wrapped) {
      this._engineErrorFromOn = true;
      return;
    }
    this._emitBridgeActive = true;
    const release = (): void => {
      this._releaseEmit = undefined;
      this._emitBridgeActive = false;
      active = false;
      if (errorBus.emit === wrapped) errorBus.emit = previous;
    };
    this._releaseEmit = release;
    this.deps.disposables.add("errors:emit", createDisposable(release));
  }

  private _applyBusEvent(event: BusErrorPayload): void {
    switch (event.level) {
      case "verbose":
        this.deps.logger.debug(event.message, { code: event.code });
        break;
      case "info":
        this.deps.logger.info(event.message, { code: event.code });
        break;
      case "warning":
        this.deps.logger.warn(event.message, { code: event.code });
        break;
      case "error":
      case "fatal":
        this.deps.logger.error(event.message, { code: event.code });
        break;
      default:
        break;
    }
    this._noteIsolation(event);
    if (this._engineErrorFromOn) this._fireEngineErrorHook(event);
  }

  private _fireEngineErrorHook(event: BusErrorPayload): void {
    if (event.level !== "error" && event.level !== "fatal") return;
    const frame =
      typeof event.context?.frame === "number" ? event.context.frame : this.deps.frame();
    const payload: EngineErrorPayload = {
      level: event.level,
      code: event.code,
      message: event.message,
      cause: event.error,
      frame,
      ...(event.source !== undefined ? { source: event.source } : {}),
      ...(event.target !== undefined ? { target: event.target } : {}),
    };
    // hookable 6.1.0 turns a sync hook throw into a rejected promise.
    // This catch does not see that rejection. `_catchAsync` logs it.
    try {
      const result: unknown = this.deps.hooks.callHook("engine:error", payload);
      this._catchAsync(result);
    } catch (error) {
      this._logHandlerFailed(error);
    }
  }

  private _firePluginError(
    pluginName: string,
    phase: PluginErrorContext["phase"],
    error: unknown,
    hook?: string,
  ): void {
    try {
      const result: unknown = this.deps.hooks.callHook("plugin:error", {
        pluginName,
        phase,
        error,
        frame: this.deps.frame(),
        ...(hook !== undefined ? { hook } : {}),
      });
      this._catchAsync(result);
    } catch (handlerError) {
      this._logHandlerFailed(handlerError);
    }
  }

  private _pluginForTarget(target: GwenErrorTarget): GwenPlugin | undefined {
    if (target.kind === "plugin") {
      return this.deps.pluginNamed(target.id);
    }
    if (target.kind === "system") {
      return this.deps.pluginNamed(target.name);
    }
    return undefined;
  }

  private _consultRecover(
    plugin: GwenPlugin,
    err: unknown,
    phase: PluginErrorContext["phase"],
    hook?: string,
  ): boolean {
    if (!plugin.onError) return false;
    let recovered = false;
    try {
      plugin.onError(err, {
        phase,
        ...(hook !== undefined ? { hook } : {}),
        frame: this.deps.frame(),
        recover() {
          recovered = true;
        },
      });
    } catch (handlerError) {
      this._logHandlerFailed(handlerError);
    }
    return recovered;
  }
}
