import { type Hookable } from "hookable";
import type { IGwenLogger } from "@gwenjs/schema";
import { GwenError } from "@gwenjs/schema";
import { clamp } from "@gwenjs/math";

import type { GwenRuntimeHooks } from "./runtime-hooks.js";
import { popEngine, pushEngine } from "./engine-local.js";
import { isThenable } from "./error-isolation.js";
import { CoreErrorCodes, GwenEngineStateError } from "./engine-errors.js";
import type { EngineFramePhaseMs, GwenEngine } from "./engine-types.js";
import type { EngineErrorPolicy } from "./engine-error-policy.js";
import type { EngineMemory } from "./engine-memory.js";
import type { EngineStateMachine } from "./engine-state.js";
import type { EngineStatsRecorder } from "./engine-stats.js";

/**
 * Mutable engine knobs. Read on each frame. Never copied into the loop.
 */
export interface EngineLoopConfig {
  timeScale: number;
  physicsHz: number;
  maxCatchupSteps: number;
  targetFPS: number;
  maxDeltaSeconds: number;
  debug: boolean;
}

/** The bridge calls the frame loop actually makes. */
export interface EngineLoopBridge {
  checkMemoryGrow(): boolean;
  getLinearMemory(): WebAssembly.Memory | null;
  engine(): { update_transforms?: () => void };
}

/** Module stepping used between `engine:before-update` and `update_transforms`. */
export interface EngineLoopModules {
  stepAll(dt: number): void;
  checkSentinels(): void;
}

export interface EngineLoopDeps {
  owner: GwenEngine;
  config: EngineLoopConfig;
  hooks: Hookable<GwenRuntimeHooks>;
  stats: EngineStatsRecorder;
  modules: EngineLoopModules;
  bridge: EngineLoopBridge;
  memory: EngineMemory;
  policy: EngineErrorPolicy;
  state: EngineStateMachine;
  logger: IGwenLogger;
}

/**
 * Scheduled frames and `advance`. One loop per engine.
 * @internal
 */
export class EngineLoop {
  private _advancing = false;
  private _rafHandle: number | ReturnType<typeof setTimeout> = 0;
  private _lastFrameTime = 0;
  private _accumulator = 0;
  private _lastPhaseMs?: EngineFramePhaseMs;
  private _sumPhases = false;
  private _displayTimed = false;
  private _displayT0 = 0;

  constructor(private readonly deps: EngineLoopDeps) {}

  get lastPhaseMs(): EngineFramePhaseMs | undefined {
    return this._lastPhaseMs;
  }

  /** Stamp the clock before `engine:init`, so the first raw frame includes that wait. */
  markStart(): void {
    this._lastFrameTime = performance.now();
  }

  cancel(): void {
    if (!this._rafHandle) return;
    this._cancelFrame(this._rafHandle);
    this._rafHandle = 0;
  }

  // ─── Frame scheduler ─────────────────────────────────────────────────────
  /**
   * Schedule the next animation frame.
   * Uses `requestAnimationFrame` on the main thread; falls back to `setTimeout`
   * in Web Worker contexts where RAF is unavailable.
   */
  private _scheduleFrame(cb: (time: number) => void): number | ReturnType<typeof setTimeout> {
    if (typeof requestAnimationFrame !== "undefined") {
      return requestAnimationFrame(cb);
    }
    // Worker fallback: no visual sync, but keeps the loop running.
    return setTimeout(() => cb(performance.now()), 0);
  }

  /** Cancel a previously scheduled frame (RAF or setTimeout handle). */
  private _cancelFrame(handle: number | ReturnType<typeof setTimeout>): void {
    if (typeof cancelAnimationFrame !== "undefined") {
      if (typeof handle === "number") cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  }

  startScheduled(): void {
    if (this.deps.config.physicsHz) {
      // Fixed timestep loop — accumulator pattern
      const fixedDt = 1 / this.deps.config.physicsHz;
      this._accumulator = 0;

      const loop = async (now: number) => {
        if (this.deps.state.state !== "running") return;

        try {
          const rawSeconds = (now - this._lastFrameTime) / 1000;
          this._lastFrameTime = now;
          this.deps.stats.recordRawFrameTime(rawSeconds);
          this._accumulator += Math.min(rawSeconds, this.deps.config.maxDeltaSeconds);

          let steps = 0;
          this._sumPhases = true;
          this._displayTimed = false;
          try {
            while (
              this._accumulator >= fixedDt &&
              steps < this.deps.config.maxCatchupSteps &&
              this.deps.state.state === "running"
            ) {
              const scaledDt = fixedDt * clamp(this.deps.config.timeScale, 0, 100);
              this.deps.stats.setDeltaTime(scaledDt);
              try {
                await this._runFrame(scaledDt);
              } catch (err) {
                this.deps.policy.handleFrameLoopError(err);
              }
              if (this.deps.state.state !== "running") break;
              this._accumulator -= fixedDt;
              steps++;
            }
          } finally {
            this._sumPhases = false;
            this._displayTimed = false;
          }
        } finally {
          if (this.deps.state.state === "running") this._rafHandle = this._scheduleFrame(loop);
        }
      };
      this._rafHandle = this._scheduleFrame(loop);
    } else {
      // Variable dt loop — original behaviour
      const loop = async (now: number) => {
        if (this.deps.state.state !== "running") return;

        // Throttle to targetFPS: skip frame if minimum interval hasn't elapsed.
        // Use a 0.5ms tolerance to account for RAF timing jitter.
        const frameBudgetMs = 1000 / this.deps.config.targetFPS;
        if (now - this._lastFrameTime < frameBudgetMs - 0.5) {
          if (this.deps.state.state === "running") this._rafHandle = this._scheduleFrame(loop);
          return;
        }

        const rawSeconds = (now - this._lastFrameTime) / 1000;
        this.deps.stats.recordRawFrameTime(rawSeconds);
        const dt =
          Math.min(rawSeconds, this.deps.config.maxDeltaSeconds) *
          clamp(this.deps.config.timeScale, 0, 100);
        this._lastFrameTime = now;
        this.deps.stats.setDeltaTime(dt);
        try {
          await this._runFrame(dt);
        } catch (err) {
          this.deps.policy.handleFrameLoopError(err);
        } finally {
          if (this.deps.state.state === "running") this._rafHandle = this._scheduleFrame(loop);
        }
      };
      this._rafHandle = this._scheduleFrame(loop);
    }
  }

  async advance(dt: number): Promise<void> {
    if (this.deps.state.state !== "idle" && this.deps.state.state !== "running") {
      throw new GwenEngineStateError(this.deps.state.state, "advance");
    }
    if (this._advancing) {
      throw new GwenError(
        CoreErrorCodes.ADVANCE_REENTRANT,
        "[GwenEngine] advance() called re-entrantly — only one advance per frame.",
      );
    }
    this._advancing = true;
    this.deps.stats.recordRawFrameTime(dt);
    // Cap dt at maxDeltaSeconds to prevent spiral-of-death after tab suspension.
    const cappedDt =
      Math.min(dt, this.deps.config.maxDeltaSeconds) * clamp(this.deps.config.timeScale, 0, 100);
    this.deps.stats.setDeltaTime(cappedDt);
    try {
      await this._runFrame(cappedDt);
    } catch (err) {
      this.deps.policy.handleFrameLoopError(err);
    } finally {
      this._advancing = false;
    }
  }

  /** One phase object for the life of the engine. Created on the first timed frame. */
  private _phaseSlot(): EngineFramePhaseMs {
    const existing = this._lastPhaseMs;
    if (existing !== undefined) return existing;
    const slot: EngineFramePhaseMs = {
      tick: 0,
      plugins: 0,
      wasm: 0,
      update: 0,
      render: 0,
      afterTick: 0,
      total: 0,
    };
    this._lastPhaseMs = slot;
    return slot;
  }

  private _settleHook(hook: string, result: unknown): unknown {
    if (!isThenable(result)) return undefined;
    return result.then(undefined, (error: unknown) => {
      this.deps.policy.reportCaught(error, hook);
    });
  }

  private _guardHook0(hook: "engine:render"): unknown {
    let result: unknown;
    try {
      result = this.deps.hooks.callHook(hook);
    } catch (error) {
      this.deps.policy.reportCaught(error, hook);
      return undefined;
    }
    return this._settleHook(hook, result);
  }

  private _guardHook1(
    hook:
      | "engine:tick"
      | "engine:before-update"
      | "engine:update"
      | "engine:after-update"
      | "engine:afterTick",
    arg: number,
  ): unknown {
    let result: unknown;
    try {
      result = this.deps.hooks.callHook(hook, arg);
    } catch (error) {
      this.deps.policy.reportCaught(error, hook);
      return undefined;
    }
    return this._settleHook(hook, result);
  }

  /**
   * One identity check before a frame phase.
   * Returns a promise only when memory grew, so a quiet frame stays synchronous.
   * A handler that throws is an error on the bus. The frame continues.
   */
  private _onPhaseBoundary(): Promise<void> | void {
    if (!this.deps.bridge.checkMemoryGrow()) return;
    const memory = this.deps.bridge.getLinearMemory();
    const byteLength = memory === null ? 0 : memory.buffer.byteLength;
    const frame = this.deps.stats.frameCount;
    this.deps.memory.noteGrowth(frame);
    let pending: Promise<unknown> | void;
    try {
      pending = this.deps.hooks.callHook("engine:memory-grow", {
        epoch: this.deps.memory.epoch,
        byteLength,
        frame,
      }) as Promise<unknown> | void;
    } catch (error: unknown) {
      this._reportMemoryGrow(error, frame);
      return;
    }
    if (pending === undefined || pending === null || typeof pending.then !== "function") return;
    return pending.then(
      () => undefined,
      (error: unknown) => {
        this._reportMemoryGrow(error, frame);
      },
    );
  }

  private _reportMemoryGrow(error: unknown, frame: number): void {
    this.deps.policy.reportMemoryGrow(error, frame);
  }

  private async _runFrame(dt: number): Promise<void> {
    // Phases start with this engine current. Each hook handler re-asserts it
    // before it runs. After an await, the continuation keeps this engine only
    // when no other engine has run. `finally` restores the engine found on
    // entry when this engine is still current, and never clears another engine.
    const previousEngine = pushEngine(this.deps.owner);
    // Single per-frame debug read. Timers, sentinels, and the budget scan sit under it.
    const instrument = __GWEN_DEV__ && this.deps.config.debug;
    let t0 = 0;
    let t1 = 0;
    let t2 = 0;
    let t3 = 0;
    let t5 = 0;
    let t6 = 0;
    let t7 = 0;
    let t8 = 0;
    if (instrument) t0 = performance.now();
    try {
      // Phase 1 — engine:tick hook (fires before any plugin work)
      if (instrument) t1 = performance.now();
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      const tickDone = this._guardHook1("engine:tick", dt);
      if (isThenable(tickDone)) await tickDone;
      if (instrument) t2 = performance.now();

      // Phase 2 — emit before-update hook (physics plugins step here)
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      const beforeDone = this._guardHook1("engine:before-update", dt);
      if (isThenable(beforeDone)) await beforeDone;
      if (instrument) t3 = performance.now();

      // Phase 3 — community WASM modules step (Cas B: user WASM, registration order)
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      this.deps.modules.stepAll(dt);
      if (instrument) t5 = performance.now();

      // Memory sentinel — dev+debug only, and only when shared memory is active.
      if (instrument) this.deps.modules.checkSentinels();

      // Phase 4 — ECS query flush + transform propagation
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      // update_transforms() propagates local→world transforms so that
      // get_entity_world_x/y/rotation return up-to-date values in onUpdate.
      try {
        this.deps.bridge.engine().update_transforms?.();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.deps.policy.reportCaught(err, "update_transforms", {
          message: `update_transforms failed: ${detail}`,
        });
      }

      // Phase 5 — emit update hook
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      const updateDone = this._guardHook1("engine:update", dt);
      if (isThenable(updateDone)) await updateDone;
      if (instrument) t6 = performance.now();

      // Phase 6a — emit after-update hook
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      const afterDone = this._guardHook1("engine:after-update", dt);
      if (isThenable(afterDone)) await afterDone;
      if (this.deps.state.isFaulted()) return;

      // Phase 6b — emit render hook
      const renderDone = this._guardHook0("engine:render");
      if (isThenable(renderDone)) await renderDone;
      if (instrument) t7 = performance.now();

      // Phase 7 — update stats, then fire engine:afterTick hook
      if (this.deps.state.isFaulted()) return;
      {
        const memoryGrow = this._onPhaseBoundary();
        if (memoryGrow !== undefined) await memoryGrow;
      }
      if (this.deps.state.isFaulted()) return;
      this.deps.stats.frameCompleted();
      const afterTickDone = this._guardHook1("engine:afterTick", dt);
      if (isThenable(afterTickDone)) await afterTickDone;
      if (instrument) t8 = performance.now();

      if (instrument) {
        const tick = t2 - t1;
        const plugins = t3 - t2;
        const wasm = t5 - t3;
        const update = t6 - t5;
        const render = t7 - t6;
        const afterTick = t8 - t7;
        const slot = this._phaseSlot();
        if (this._sumPhases && this._displayTimed) {
          slot.tick += tick;
          slot.plugins += plugins;
          slot.wasm += wasm;
          slot.update += update;
          slot.render += render;
          slot.afterTick += afterTick;
          slot.total = t8 - this._displayT0;
        } else {
          slot.tick = tick;
          slot.plugins = plugins;
          slot.wasm = wasm;
          slot.update = update;
          slot.render = render;
          slot.afterTick = afterTick;
          slot.total = t8 - t0;
          if (this._sumPhases) {
            this._displayTimed = true;
            this._displayT0 = t0;
          }
        }
        const budget = 1000 / this.deps.config.targetFPS;
        if (tick > budget * 0.5) {
          this.deps.logger.warn(`phase "tick" exceeded 50% of frame budget`, {
            phase: "tick",
            ms: tick.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this.deps.stats.frameCount,
          });
        }
        if (plugins > budget * 0.5) {
          this.deps.logger.warn(`phase "plugins" exceeded 50% of frame budget`, {
            phase: "plugins",
            ms: plugins.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this.deps.stats.frameCount,
          });
        }
        if (wasm > budget * 0.5) {
          this.deps.logger.warn(`phase "wasm" exceeded 50% of frame budget`, {
            phase: "wasm",
            ms: wasm.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this.deps.stats.frameCount,
          });
        }
        if (update > budget * 0.5) {
          this.deps.logger.warn(`phase "update" exceeded 50% of frame budget`, {
            phase: "update",
            ms: update.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this.deps.stats.frameCount,
          });
        }
        if (render > budget * 0.5) {
          this.deps.logger.warn(`phase "render" exceeded 50% of frame budget`, {
            phase: "render",
            ms: render.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this.deps.stats.frameCount,
          });
        }
        if (afterTick > budget * 0.5) {
          this.deps.logger.warn(`phase "afterTick" exceeded 50% of frame budget`, {
            phase: "afterTick",
            ms: afterTick.toFixed(2),
            budgetMs: budget.toFixed(2),
            frame: this.deps.stats.frameCount,
          });
        }
      }
    } finally {
      popEngine(this.deps.owner, previousEngine);
    }
  }
}
