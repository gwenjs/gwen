/**
 * @file Frame boundary shared by every `hotReplace*` function. Dev only.
 *
 * @module
 */

import { readInFrame, whenFrameIdle } from "../engine/engine-internals.js";
import type { GwenEngine } from "../engine/engine-types.js";

/** True while the engine takes a swap: `idle` or `running`. */
export function isLive(engine: GwenEngine): boolean {
  return engine.state === "idle" || engine.state === "running";
}

/** Resolves when the frame in flight has ended, or when the engine changes state (a stop). */
function frameEnd(engine: GwenEngine): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      off();
      resolve();
    };
    const off = engine.hooks.hook("engine:state-change", done);
    void whenFrameIdle(engine).then(done);
  });
}

/**
 * Wait until no frame is in flight. A display frame is every step and its render pass.
 * @returns false when the engine stopped meanwhile: the swap has to reload.
 */
export async function settle(engine: GwenEngine): Promise<boolean> {
  while (readInFrame(engine) && isLive(engine)) await frameEnd(engine);
  return isLive(engine);
}
