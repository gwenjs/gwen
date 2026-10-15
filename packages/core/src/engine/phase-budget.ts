import type { IGwenLogger } from "@gwenjs/schema";

import type { EngineFramePhaseMs } from "./engine-types.js";

/** One timed pass through `_runFrame`. Times are `performance.now()` stamps. */
export interface PhaseSample {
  sumPhases: boolean;
  displayTimed: boolean;
  displayT0: number;
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  t5: number;
  t6: number;
  t7: number;
  t8: number;
  targetFPS: number;
  frame: number;
}

/**
 * Write one step onto `slot`. The first step of a display frame replaces the
 * slot. Later steps add. Returns the display-frame clock for the next step.
 */
export function recordPhaseBudget(
  slot: EngineFramePhaseMs,
  sample: PhaseSample,
  logger: IGwenLogger,
): { displayTimed: boolean; displayT0: number } {
  const tick = sample.t2 - sample.t1;
  const plugins = sample.t3 - sample.t2;
  const wasm = sample.t5 - sample.t3;
  const update = sample.t6 - sample.t5;
  const render = sample.t7 - sample.t6;
  const afterTick = sample.t8 - sample.t7;
  let displayTimed = sample.displayTimed;
  let displayT0 = sample.displayT0;
  if (sample.sumPhases && displayTimed) {
    slot.tick += tick;
    slot.plugins += plugins;
    slot.wasm += wasm;
    slot.update += update;
    slot.render += render;
    slot.afterTick += afterTick;
    slot.total = sample.t8 - displayT0;
  } else {
    slot.tick = tick;
    slot.plugins = plugins;
    slot.wasm = wasm;
    slot.update = update;
    slot.render = render;
    slot.afterTick = afterTick;
    slot.total = sample.t8 - sample.t0;
    if (sample.sumPhases) {
      displayTimed = true;
      displayT0 = sample.t0;
    }
  }
  const budget = 1000 / sample.targetFPS;
  if (tick > budget * 0.5) {
    logger.warn(`phase "tick" exceeded 50% of frame budget`, {
      phase: "tick",
      ms: tick.toFixed(2),
      budgetMs: budget.toFixed(2),
      frame: sample.frame,
    });
  }
  if (plugins > budget * 0.5) {
    logger.warn(`phase "plugins" exceeded 50% of frame budget`, {
      phase: "plugins",
      ms: plugins.toFixed(2),
      budgetMs: budget.toFixed(2),
      frame: sample.frame,
    });
  }
  if (wasm > budget * 0.5) {
    logger.warn(`phase "wasm" exceeded 50% of frame budget`, {
      phase: "wasm",
      ms: wasm.toFixed(2),
      budgetMs: budget.toFixed(2),
      frame: sample.frame,
    });
  }
  if (update > budget * 0.5) {
    logger.warn(`phase "update" exceeded 50% of frame budget`, {
      phase: "update",
      ms: update.toFixed(2),
      budgetMs: budget.toFixed(2),
      frame: sample.frame,
    });
  }
  if (render > budget * 0.5) {
    logger.warn(`phase "render" exceeded 50% of frame budget`, {
      phase: "render",
      ms: render.toFixed(2),
      budgetMs: budget.toFixed(2),
      frame: sample.frame,
    });
  }
  if (afterTick > budget * 0.5) {
    logger.warn(`phase "afterTick" exceeded 50% of frame budget`, {
      phase: "afterTick",
      ms: afterTick.toFixed(2),
      budgetMs: budget.toFixed(2),
      frame: sample.frame,
    });
  }
  return { displayTimed, displayT0 };
}
