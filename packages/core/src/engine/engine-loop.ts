import { type Hookable } from "hookable";
import type { IGwenLogger } from "@gwenjs/schema";
import { GwenError } from "@gwenjs/schema";
import { clamp } from "@gwenjs/math";

import type { GwenRuntimeHooks } from "./runtime-hooks.js";
import { popEngine, pushEngine } from "./engine-local.js";
import { isThenable } from "./error-isolation.js";
import { CoreErrorCodes, GwenEngineStateError } from "./engine-errors.js";
import type { EngineFrame, EngineFramePhaseMs, GwenEngine } from "./engine-types.js";
import type { EngineErrorPolicy } from "./engine-error-policy.js";
import type { EngineMemory } from "./engine-memory.js";
import type { EngineStateMachine } from "./engine-state.js";
import type { EngineStatsRecorder } from "./engine-stats.js";
import { cancelScheduledFrame, scheduleFrame } from "./frame-scheduler.js";
import {
  armFixedStepState,
  commitFixedStepHistory,
  createFixedStepState,
  emitEngineRender,
  runFixedDisplay,
  type DisplayTiming,
} from "./fixed-display.js";
import { recordPhaseBudget } from "./phase-budget.js";

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
  engine(): {
    update_transforms?: () => void;
    transform_history_commit?: () => number;
  };
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
  private readonly _fixed = createFixedStepState();
  private readonly _timing: DisplayTiming = { timed: false, t0: 0 };
  private _lastPhaseMs?: EngineFramePhaseMs;

  constructor(private readonly deps: EngineLoopDeps) {}

  get lastPhaseMs(): EngineFramePhaseMs | undefined {
    return this._lastPhaseMs;
  }

  /** The engine's one display-frame object. */
  get frame(): EngineFrame {
    return this._fixed.frame;
  }

  /**
   * Capture `fixedDt` and reset the shared accumulator.
   * With `physicsHz > 0`, seed the history buffers once.
   */
  armFixedStep(): void {
    armFixedStepState(this._fixed, this.deps);
  }

  /** Stamp the clock before `engine:init`, so the first raw frame includes that wait. */
  markStart(): void {
    this._lastFrameTime = performance.now();
  }

  cancel(): void {
    if (!this._rafHandle) return;
    cancelScheduledFrame(this._rafHandle);
    this._rafHandle = 0;
  }

  startScheduled(): void {
    if (this.deps.config.physicsHz) {
      this.armFixedStep();

      const loop = async (now: number) => {
        if (this.deps.state.state !== "running") return;

        try {
          const rawSeconds = (now - this._lastFrameTime) / 1000;
          this._lastFrameTime = now;
          this.deps.stats.recordRawFrameTime(rawSeconds);
          try {
            await runFixedDisplay(
              this._fixed,
              this.deps,
              rawSeconds,
              (scaledDt) => this._runFrame(scaledDt, false),
              () => this._phaseSlot(),
              this._timing,
              () => performance.now(),
            );
          } catch (err) {
            this.deps.policy.handleFrameLoopError(err);
          }
        } finally {
          if (this.deps.state.state === "running") this._rafHandle = scheduleFrame(loop);
        }
      };
      this._rafHandle = scheduleFrame(loop);
    } else {
      const loop = async (now: number) => {
        if (this.deps.state.state !== "running") return;

        // Throttle to targetFPS: skip frame if minimum interval hasn't elapsed.
        // Use a 0.5ms tolerance to account for RAF timing jitter.
        const frameBudgetMs = 1000 / this.deps.config.targetFPS;
        if (now - this._lastFrameTime < frameBudgetMs - 0.5) {
          if (this.deps.state.state === "running") this._rafHandle = scheduleFrame(loop);
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
          if (this.deps.state.state === "running") this._rafHandle = scheduleFrame(loop);
        }
      };
      this._rafHandle = scheduleFrame(loop);
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
    if (this._fixed.fixedDt > 0) {
      try {
        await runFixedDisplay(
          this._fixed,
          this.deps,
          dt,
          (scaledDt) => this._runFrame(scaledDt, false),
          () => this._phaseSlot(),
          this._timing,
          () => performance.now(),
        );
      } catch (err) {
        this.deps.policy.handleFrameLoopError(err);
      } finally {
        this._advancing = false;
      }
      return;
    }
    // Cap dt at maxDeltaSeconds to prevent spiral-of-death after tab suspension.
    const cappedDt =
      Math.min(dt, this.deps.config.maxDeltaSeconds) * clamp(this.deps.config.timeScale, 0, 100);
    this.deps.stats.setDeltaTime(cappedDt);
    try {
      await this._runFrame(cappedDt, true);
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

  private async _runFrame(dt: number, includeRender = true): Promise<void> {
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
      if (!includeRender) commitFixedStepHistory(this.deps);

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

      // Phase 6b — variable loop only. Fixed mode renders once after the steps.
      if (includeRender) {
        this._fixed.frame.steps = 1;
        this._fixed.frame.alpha = 1;
        this._fixed.frame.rendering = true;
        const renderDone = emitEngineRender(this.deps, 1);
        if (isThenable(renderDone)) await renderDone;
        this._fixed.frame.rendering = false;
      }
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
        const next = recordPhaseBudget(
          this._phaseSlot(),
          {
            sumPhases: this._fixed.sumPhases,
            displayTimed: this._timing.timed,
            displayT0: this._timing.t0,
            t0,
            t1,
            t2,
            t3,
            t5,
            t6,
            t7,
            t8,
            targetFPS: this.deps.config.targetFPS,
            frame: this.deps.stats.frameCount,
          },
          this.deps.logger,
        );
        this._timing.timed = next.displayTimed;
        this._timing.t0 = next.displayT0;
      }
    } finally {
      popEngine(this.deps.owner, previousEngine);
    }
  }
}
