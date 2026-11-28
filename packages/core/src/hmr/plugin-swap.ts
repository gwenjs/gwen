/**
 * @file Which plugin an engine is swapping right now. Dev only.
 *
 * `hotReplacePlugin` marks both plugin names for the length of the swap.
 * `emitServiceChange` reads the mark so those plugins' notices use `hot-replace`.
 *
 * @module
 */

import type { ServiceChangeReason } from "@gwenjs/schema";
import type { GwenEngine } from "../engine/engine-types.js";

const swapping = new WeakMap<GwenEngine, Set<string>>();

/** Remember every name until the returned function runs. */
export function markSwap(engine: GwenEngine, names: readonly string[]): () => void {
  swapping.set(engine, new Set(names));
  return () => {
    swapping.delete(engine);
  };
}

/**
 * `hot-replace` while `owner` is a name `markSwap` recorded, otherwise `reason`.
 * A notice with no owner keeps its reason.
 */
export function hotServiceReason(
  engine: GwenEngine,
  owner: string | undefined,
  reason: ServiceChangeReason,
): ServiceChangeReason {
  const marked = swapping.get(engine);
  return owner !== undefined && marked !== undefined && marked.has(owner) ? "hot-replace" : reason;
}
