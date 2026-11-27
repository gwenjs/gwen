import { clamp } from "@gwenjs/math";

import type { EngineFramePhaseMs } from "./engine-types.js";
import { installHistoryViews, type HistoryViews } from "./history-views.js";
import { installHistoryViews3D, type HistoryViews3D } from "./history-views-3d.js";
import type { TransformPair2D } from "./transform-pair.js";
import { beginPass, setPassOn } from "../introspection/timing-store.js";

/** The bridge calls the frame loop actually makes. */
export interface EngineLoopBridge {
  checkMemoryGrow(): boolean;
  getLinearMemory(): WebAssembly.Memory | null;
  engine(): {
    update_transforms?: () => void;
    transform_history_commit?: () => number;
    transform_history_ptr?: (buffer: number) => number;
    transform3d_history_commit?: () => number;
    transform3d_history_ptr?: (buffer: number) => number;
  };
}

/**
 * Loop-owned frame. Field writes stay here.
 * The same object is returned as the readonly public `EngineFrame`.
 */
interface MutableEngineFrame {
  alpha: number;
  fixedStep: boolean;
  steps: number;
  rendering: boolean;
  transforms2D: TransformPair2D | null;
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
  history: HistoryViews | null;
  history3d: HistoryViews3D | null;
  sumPhases: boolean;
  /** True from the first step to the end of the render pass of one display frame. */
  inDisplay: boolean;
  /** Set by the first `transform:2d` `track`. Starts the history commit at `physicsHz: 0`. */
  historyWanted: boolean;
  /**
   * Set by the first `transform:3d` `track`, and by `useTransform3D()` when `physicsHz > 0`.
   * Starts the 3D history commit. With the flag clear, no 3D buffer is allocated.
   */
  history3dWanted: boolean;
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
    history: null,
    history3d: null,
    sumPhases: false,
    inDisplay: false,
    historyWanted: false,
    history3dWanted: false,
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
      seedHistory(state, deps, true);
      if (state.history3dWanted) seedHistory3D(state, deps);
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
  // A 0-step display never reaches `commitFrameHistory`. Seed here so the first render
  // after `track` still reads the pose committed before that display's steps.
  if (state.history3dWanted && state.history3d === null) seedHistory3D(state, deps);
  let steps = 0;
  state.sumPhases = true;
  state.inDisplay = true;
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
    state.inDisplay = false;
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

function commitHistory(deps: EngineLoopDeps): number | undefined {
  try {
    const parity = deps.bridge.engine().transform_history_commit?.();
    return typeof parity === "number" ? parity : undefined;
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
    return undefined;
  }
}

/**
 * `update_transforms`, then two commits, then the four history views.
 * `publish` also sets `frame.transforms2D`. The variable-step seed passes false: that field
 * stays `null` at `physicsHz: 0`, and only the `transform:2d` reader sees the views.
 */
function seedHistory(state: FixedStepState, deps: EngineLoopDeps, publish: boolean): void {
  try {
    deps.bridge.engine().update_transforms?.();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.policy.reportCaught(err, "update_transforms", {
      message: `update_transforms failed: ${detail}`,
    });
  }
  commitHistory(deps);
  const parity = commitHistory(deps);
  if (parity === undefined || state.history !== null) return;
  const wasm = deps.bridge.engine();
  const readPtr = wasm.transform_history_ptr;
  if (readPtr === undefined) return;
  const installed = installHistoryViews(
    deps.memory,
    deps.owner.maxEntities,
    (buffer) => readPtr.call(wasm, buffer),
    parity,
  );
  if (installed === undefined) return;
  state.history = installed;
  if (publish) state.frame.transforms2D = installed.pair;
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
    if (__GWEN_DEV__) {
      // A display frame with steps renders inside the record of its last step.
      // One with no step starts a record of its own.
      if (frame.steps === 0) beginPass(deps.owner, deps.stats.frameCount, instrument, readNow);
      else setPassOn(deps.owner, instrument);
    }
    const renderDone = emitEngineRender(deps, alpha);
    if (isThenable(renderDone)) await renderDone;
    if (instrument && sumPhases) {
      const slot = phaseSlot();
      const render = readNow() - t0;
      slot.render += render;
      slot.total += render;
    }
  } finally {
    if (__GWEN_DEV__) setPassOn(deps.owner, false);
    frame.rendering = false;
    popEngine(deps.owner, previousEngine);
  }
}

/** History commit after `update_transforms`, only on a fixed step. */
export function commitFixedStepHistory(state: FixedStepState, deps: EngineLoopDeps): void {
  const parity = commitHistory(deps);
  if (parity !== undefined) state.history?.setParity(parity);
}

/**
 * History commit after `update_transforms`. A fixed step always commits. A variable frame
 * commits once the views exist, and creates them on the first frame after a `track` at
 * `physicsHz: 0`. With no ref ever tracked, a variable frame does nothing.
 */
export function commitFrameHistory(
  state: FixedStepState,
  deps: EngineLoopDeps,
  variable: boolean,
): void {
  if (!variable || state.history !== null) {
    commitFixedStepHistory(state, deps);
  } else if (state.historyWanted && deps.config.physicsHz === 0) {
    seedHistory(state, deps, false);
  }
  if (state.history3dWanted) commitHistory3D(state, deps);
}

/** Drop the history views. Later reads throw `CORE:MEMORY_VIEW_INVALID`. */
export function releaseHistoryViews(state: FixedStepState): void {
  const history = state.history;
  const history3d = state.history3d;
  state.history = null;
  state.history3d = null;
  state.frame.transforms2D = null;
  history?.dispose();
  history3d?.dispose();
}

function commitHistory3DOnce(deps: EngineLoopDeps, report: boolean): number | undefined {
  try {
    const parity = deps.bridge.engine().transform3d_history_commit?.();
    return typeof parity === "number" ? parity : undefined;
  } catch (err) {
    if (!report) return undefined;
    const detail = err instanceof Error ? err.message : String(err);
    const code = thrownCode(err);
    deps.policy.reportCaught(
      err,
      "transform3d_history_commit",
      code === undefined
        ? { message: `transform3d_history_commit failed: ${detail}` }
        : { message: `transform3d_history_commit failed: ${detail}`, code },
    );
    return undefined;
  }
}

/**
 * `update_transforms`, then two commits, then the four 3D history views.
 * A second call does nothing once the views exist: the two commits would move the parity.
 * Nothing is written on `frame`. The 2D views stay on their own path.
 * A throw here is not reported. The fixed step reports that failure once.
 */
function seedHistory3D(state: FixedStepState, deps: EngineLoopDeps): void {
  if (state.history3d !== null) return;
  try {
    deps.bridge.engine().update_transforms?.();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    deps.policy.reportCaught(err, "update_transforms", {
      message: `update_transforms failed: ${detail}`,
    });
  }
  commitHistory3DOnce(deps, false);
  const parity = commitHistory3DOnce(deps, false);
  if (parity === undefined) return;
  const wasm = deps.bridge.engine();
  const readPtr = wasm.transform3d_history_ptr;
  if (readPtr === undefined) return;
  const installed = installHistoryViews3D(
    deps.memory,
    deps.owner.maxEntities,
    (buffer) => readPtr.call(wasm, buffer),
    parity,
  );
  if (installed === undefined) return;
  state.history3d = installed;
}

/** First call seeds. Later calls commit once and publish the parity. */
function commitHistory3D(state: FixedStepState, deps: EngineLoopDeps): void {
  if (state.history3d === null) {
    seedHistory3D(state, deps);
    if (state.history3d === null) commitHistory3DOnce(deps, true);
    return;
  }
  const parity = commitHistory3DOnce(deps, true);
  if (parity !== undefined) state.history3d.setParity(parity);
}
