import type { ComponentDef } from "../system/runtime/define-system";
import type { EntityId } from "./engine-api";
import type { GwenEngine } from "./engine-types.js";
import { CoreErrorCodes } from "./engine-errors.js";

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

/**
 * Update phase and the per-entity warning, keyed by the engine object.
 * Not a field or a method on a system or a plugin.
 */
type SystemFramePhase = "engine:before-update" | "engine:update" | "engine:after-update";

type PerEntityApi = "Query.each" | "useComponentFor";

const framePhases = new WeakMap<object, SystemFramePhase>();
const systemDepths = new WeakMap<object, number>();
const suppressDepths = new WeakMap<object, number>();
const warnedApis = new WeakMap<object, Set<PerEntityApi>>();
const queryEngines = new WeakMap<object, GwenEngine>();

/** Remember which engine owns this chunk query. `useActorQuery` reads it back. */
export function rememberQueryEngine(query: object, engine: GwenEngine): void {
  queryEngines.set(query, engine);
}

/** Engine passed to {@link rememberQueryEngine}, if this object is a chunk query. */
export function readQueryEngine(query: object): GwenEngine | undefined {
  return queryEngines.get(query);
}

/** Set the phase `Query.each` will report. `null` clears it. */
export function setFramePhase(engine: GwenEngine, phase: SystemFramePhase | null): void {
  if (phase === null) {
    framePhases.delete(engine);
    return;
  }
  framePhases.set(engine, phase);
}

/** One system hook started. Actor, scene, and plugin hooks do not call this. */
export function enterSystemDepth(engine: GwenEngine): void {
  systemDepths.set(engine, (systemDepths.get(engine) ?? 0) + 1);
}

/** Pair of {@link enterSystemDepth}. Extra calls stop at zero. */
export function leaveSystemDepth(engine: GwenEngine): void {
  const next = (systemDepths.get(engine) ?? 0) - 1;
  if (next <= 0) {
    systemDepths.delete(engine);
    return;
  }
  systemDepths.set(engine, next);
}

/** Hide the per-entity warning while `useActorQuery` calls `Query.each`. */
export function pushPerEntitySuppress(engine: GwenEngine): void {
  suppressDepths.set(engine, (suppressDepths.get(engine) ?? 0) + 1);
}

/** Pair of {@link pushPerEntitySuppress}. Extra calls stop at zero. */
export function popPerEntitySuppress(engine: GwenEngine): void {
  const next = (suppressDepths.get(engine) ?? 0) - 1;
  if (next <= 0) {
    suppressDepths.delete(engine);
    return;
  }
  suppressDepths.set(engine, next);
}

function perEntityMessage(api: PerEntityApi): string {
  return `${api} is per-entity; iterate the query by chunk (for (const chunk of query))`;
}

/**
 * Dev-only warning. Once per engine per api.
 * No-op in prod, outside a system update phase, or while suppressed.
 * Does not throw, stop the engine, or mark the event fatal.
 */
export function warnPerEntityPath(engine: GwenEngine, api: PerEntityApi): void {
  if (!__GWEN_DEV__) return;
  const phase = framePhases.get(engine);
  if (phase === undefined) return;
  if ((systemDepths.get(engine) ?? 0) === 0) return;
  if ((suppressDepths.get(engine) ?? 0) > 0) return;
  const seen = warnedApis.get(engine);
  if (seen?.has(api) === true) return;
  const next = seen ?? new Set<PerEntityApi>();
  if (seen === undefined) warnedApis.set(engine, next);
  next.add(api);
  const context: Record<string, unknown> = {};
  context.api = api;
  context.phase = phase;
  context.frame = engine.frameCount;
  engine.errors.emit({
    level: "warning",
    code: CoreErrorCodes.QUERY_PER_ENTITY_PATH,
    source: "core",
    message: perEntityMessage(api),
    context,
  });
}
