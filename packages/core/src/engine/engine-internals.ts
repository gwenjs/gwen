import type { ComponentDef } from "../system/runtime/define-system";
import type { EntityId } from "./engine-api";
import type { GwenEngine } from "./engine-types.js";

interface EngineInternalOps {
  setDormant(id: EntityId, dormant: boolean): boolean;
  queryIds(components: readonly ComponentDef[]): readonly EntityId[];
  structuralCompares(): number;
  loopDepth(): number;
}

const engineInternals = new WeakMap<object, EngineInternalOps>();

/** Register dormancy and query access for one engine object, including a plugin proxy. */
export function rememberEngineInternals(key: object, ops: EngineInternalOps): void {
  engineInternals.set(key, ops);
}

/**
 * Pool dormancy flag. Not part of {@link GwenEngine}.
 * False when `engine` is not a GWEN engine or `id` is not alive.
 * @internal
 */
export function setEntityDormant(engine: GwenEngine, id: EntityId, dormant: boolean): boolean {
  const ops = engineInternals.get(engine);
  if (!ops) return false;
  return ops.setDormant(id, dormant);
}

/**
 * Cached id list for one query. The same array object across a dormancy toggle and a later add.
 * @internal
 */
export function readLiveQueryIds(
  engine: GwenEngine,
  components: readonly ComponentDef[],
): readonly EntityId[] {
  const ops = engineInternals.get(engine);
  if (!ops) return [];
  return ops.queryIds(components);
}

/** Key comparisons made while queueing structural ops. Test seam only. @internal */
export function readStructuralCompares(engine: GwenEngine): number {
  const ops = engineInternals.get(engine);
  if (!ops) return -1;
  return ops.structuralCompares();
}

/** Open chunk-loop depth. Test seam only. @internal */
export function readLoopDepth(engine: GwenEngine): number {
  const ops = engineInternals.get(engine);
  if (!ops) return -1;
  return ops.loopDepth();
}
