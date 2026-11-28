/**
 * @file Count of live `EngineLocal` values per engine. Dev only, read by tests.
 *
 * @module
 */

import type { GwenEngine } from "../engine/engine-types.js";

const counts = new WeakMap<GwenEngine, number>();

/** `createEngineLocal` calls this with +1 after it stores a value and -1 after it drops it. */
export function noteEngineLocal(engine: GwenEngine, delta: 1 | -1): void {
  counts.set(engine, (counts.get(engine) ?? 0) + delta);
}

/** Live `EngineLocal` values of `engine`. Zero after `stop()`. */
export function engineLocalCount(engine: GwenEngine): number {
  return counts.get(engine) ?? 0;
}
