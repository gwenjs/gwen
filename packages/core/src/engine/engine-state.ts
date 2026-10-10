import type { Hookable } from "hookable";
import { GwenError, type IGwenLogger } from "@gwenjs/schema";
import type { GwenRuntimeHooks } from "./runtime-hooks.js";
import type { GwenEngineState, GwenEngineStateChangeReason } from "./engine-types.js";
import { CoreErrorCodes, GwenEngineStateError } from "./engine-errors.js";
import { isThenable } from "./error-isolation.js";

/**
 * `hooks` and `logger` are the engine's own instances.
 * `cancelFrame` drops the facade's scheduled rAF or timeout. The facade owns the handle.
 */
export interface EngineStateMachineDeps {
  hooks: Hookable<GwenRuntimeHooks>;
  logger: IGwenLogger;
  cancelFrame: () => void;
}

/**
 * The only writer of the engine lifecycle state.
 * Sets the state before the hook runs. A throwing handler is logged.
 * It does not undo the transition or escape to the caller.
 * Returns a promise only when the hook itself returns one.
 * @internal
 */
export class EngineStateMachine {
  private _state: GwenEngineState = "idle";

  constructor(private readonly deps: EngineStateMachineDeps) {}

  get state(): GwenEngineState {
    return this._state;
  }

  transition(to: GwenEngineState, reason: GwenEngineStateChangeReason): Promise<void> | void {
    const from = this._state;
    if (from === to) return;
    this._state = to;
    let result: unknown;
    try {
      result = this.deps.hooks.callHook("engine:state-change", { from, to, reason });
    } catch (error: unknown) {
      this._logHandlerFailed(error);
      return;
    }
    if (!isThenable(result)) return;
    return Promise.resolve(result).then(
      () => undefined,
      (error: unknown) => {
        this._logHandlerFailed(error);
      },
    );
  }

  /** Plain read so a frame check does not narrow `state`. */
  isFaulted(): boolean {
    return this._state === "faulted";
  }

  enterFaulted(reason: GwenEngineStateChangeReason): void {
    if (this._state === "faulted" || this._state === "stopped") return;
    this.deps.cancelFrame();
    const pending = this.transition("faulted", reason);
    if (pending !== undefined) this._catchAsync(pending);
  }

  assert(method: string): void {
    if (this._state !== "faulted") return;
    throw new GwenError(
      CoreErrorCodes.INVALID_STATE_TRANSITION,
      `[GwenEngine] ${method}() is not allowed while the engine is faulted.`,
    );
  }

  /**
   * `use` / `unuse` are legal in `idle` and `running` only. `stopped` is terminal (#107):
   * a plugin installed after `stop()` would never be torn down.
   */
  assertPlugin(method: "use" | "unuse"): void {
    const state = this._state;
    if (state === "idle" || state === "running") {
      return;
    }
    throw new GwenEngineStateError(state, method);
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
}
