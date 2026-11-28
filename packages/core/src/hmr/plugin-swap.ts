/**
 * @file Which plugin an engine is swapping right now. Dev only.
 *
 * `hotReplacePlugin` marks the plugin name for the length of the swap.
 * `emitServiceChange` reads the mark so that plugin's notices use `hot-replace`.
 *
 * @module
 */

import type { ServiceChangeReason } from "@gwenjs/schema";
import type { GwenEngine } from "../engine/engine-types.js";

const swapping = new WeakMap<GwenEngine, string>();

/** Remember `name` until the returned function runs. */
export function markSwap(engine: GwenEngine, name: string): () => void {
  swapping.set(engine, name);
  return () => {
    swapping.delete(engine);
  };
}

/**
 * `hot-replace` while `owner` is the plugin `markSwap` recorded, otherwise `reason`.
 * A notice with no owner keeps its reason.
 */
export function hotServiceReason(
  engine: GwenEngine,
  owner: string | undefined,
  reason: ServiceChangeReason,
): ServiceChangeReason {
  return owner !== undefined && swapping.get(engine) === owner ? "hot-replace" : reason;
}
