import { clamp } from "@gwenjs/math";

import type { EngineFramePhaseMs } from "./engine-types.js";

/**
 * Loop-owned frame. Field writes stay here.
 * The same object is returned as the readonly public `EngineFrame`.
 */
interface MutableEngineFrame {
  alpha: number;
  fixedStep: boolean;
  steps: number;
  rendering: boolean;
  transforms2D: null;
}
import type { EngineLoopDeps } from "./engine-loop.js";
import { popEngine, pushEngine } from "./engine-local.js";
import { isThenable } from "./error-isolation.js";

/** Clock shared by `start()` and `advance()`. One object for the engine's life. */
export interface FixedStepState {
  accumulator: number;
  fixedDt: number;
  armed: boolean;
  frame: MutableEngineFrame;
  sumPhases: boolean;
}

/** Debug timestamps for one display frame. `t0` is the first step's start. */
export interface DisplayTiming {
  timed: boolean;
  t0: number;
}

export function createFixedStepState(): FixedStepState {
  return {
    accumulator: 0,
    fixedDt: 0,
    armed: false,
    frame: {
      alpha: 1,
      fixedStep: false,
      steps: 0,
      rendering: false,
      transforms2D: null,
    },
    sumPhases: false,
  };
}

/**
 * Capture `fixedDt` and reset the shared accumulator.
 * With `physicsHz > 0`, seed the history buffers once.
 */
export function armFixedStepState(state: FixedStepState, deps: EngineLoopDeps): void {
  state.accumulator = 0;
  const hz = deps.config.physicsHz;
  if (hz > 0) {
    state.fixedDt = 1 / hz;
    state.frame.fixedStep = true;
    if (!state.armed) {
      state.armed = true;
      seedHistory(deps);
    }
    return;
  }
  state.fixedDt = 0;
  state.frame.fixedStep = false;
  state.armed = true;
}

/** Fixed steps, then one render. `rawSeconds` is unscaled. */
export async function runFixedDisplay(
  state: FixedStepState,
  deps: EngineLoopDeps,
  rawSeconds: number,
  runStep: (dt: number) => Promise<void>,
  phaseSlot: () => EngineFramePhaseMs,
  timing: DisplayTiming,
  readNow: () => number,
): Promise<void> {
  const fixedDt = state.fixedDt;
  // A non-finite or negative dt adds nothing. The first rAF stamp can be
  // older than `markStart()`. The variable-loop path is unchanged.
  state.accumulator += Math.min(finiteElapsed(rawSeconds), deps.config.maxDeltaSeconds);
  let steps = 0;
  state.sumPhases = true;
  timing.timed = false;
  try {
    while (
      state.accumulator >= fixedDt &&
      steps < deps.config.maxCatchupSteps &&
      deps.state.state === "running"
    ) {
      const scaledDt = fixedDt * clamp(deps.config.timeScale, 0, 100);
      deps.stats.setDeltaTime(scaledDt);
      try {
        await runStep(scaledDt);
      } catch (err) {
        deps.policy.handleFrameLoopError(err);
      }
      if (deps.state.state !== "running") break;
      state.accumulator -= fixedDt;
      steps++;
    }
    if (
      steps === deps.config.maxCatchupSteps &&
      state.accumulator >= fixedDt &&
      deps.state.state === "running"
    ) {
      const dropped = Math.floor(state.accumulator / fixedDt);
      state.accumulator -= fixedDt * dropped;
    }
    state.frame.steps = steps;
    if (deps.state.state !== "running") return;
    const alpha = displayAlpha(state.accumulator, fixedDt);
    try {
      await renderDisplayPass(state.frame, alpha, deps, state.sumPhases, phaseSlot, readNow);
    } catch (err) {
      deps.policy.handleFrameLoopError(err);
    }
  } finally {
    state.sumPhases = false;
    timing.timed = false;
  }
}

export function emitEngineRender(deps: EngineLoopDeps, alpha: number): unknown {
  let result: unknown;
  try {
    result = deps.hooks.callHook("engine:render", alpha);
  } catch (error) {
    deps.policy.reportCaught(error, "engine:render");
    return undefined;
  }
  if (!isThenable(result)) return undefined;
  return result.then(undefined, (error: unknown) => {
    deps.policy.reportCaught(error, "engine:render");
  });
}

function finiteElapsed(rawSeconds: number): number {
  if (!Number.isFinite(rawSeconds) || rawSeconds < 0) return 0;
  return rawSeconds;
}

function displayAlpha(accumulator: number, fixedDt: number): number {
  const ratio = accumulator / fixedDt;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(Math.max(ratio, 0), 1 - Number.EPSILON);
}

function thrownCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = err.code;
  return typeof code === "string" ? code : undefined;
}

function commitHistory(deps: EngineLoopDeps): void {
  try {
    deps.bridge.engine().transform_history_commit?.();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const code = thrownCode(err);
    deps.policy.reportCaught(
      err,
      "transform_history_commit",
      code === undefined
        ? { message: `transform_history_commit failed: ${detail}` }
        : { message: `transform_history_commit failed: ${detail}`, code },
    );
  }
}

/** `update_transforms`, then two commits, so the first render has both buffers. */
function seedHistory(deps: EngineLoopDeps): void {
  try {
    deps.bridge.engine().update_transforms?.();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.policy.reportCaught(err, "update_transforms", {
      message: `update_transforms failed: ${detail}`,
    });
  }
  commitHistory(deps);
  commitHistory(deps);
}

async function renderDisplayPass(
  frame: MutableEngineFrame,
  alpha: number,
  deps: EngineLoopDeps,
  sumPhases: boolean,
  phaseSlot: () => EngineFramePhaseMs,
  readNow: () => number,
): Promise<void> {
  frame.alpha = alpha;
  frame.rendering = true;
  const previousEngine = pushEngine(deps.owner);
  const instrument = __GWEN_DEV__ && deps.config.debug;
  const t0 = instrument ? readNow() : 0;
  try {
    const renderDone = emitEngineRender(deps, alpha);
    if (isThenable(renderDone)) await renderDone;
    if (instrument && sumPhases) {
      const slot = phaseSlot();
      const render = readNow() - t0;
      slot.render += render;
      slot.total += render;
    }
  } finally {
    frame.rendering = false;
    popEngine(deps.owner, previousEngine);
  }
}

/** History commit after `update_transforms`, only on a fixed step. */
export function commitFixedStepHistory(deps: EngineLoopDeps): void {
  commitHistory(deps);
}
