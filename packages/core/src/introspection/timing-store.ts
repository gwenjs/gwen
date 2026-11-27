/**
 * @file Per-engine timing state. Dev only: read from `if (__GWEN_DEV__)` branches.
 *
 * Both maps are engine-locals, so `stop()` drops them with the engine. Two
 * engines never share a meter or a record.
 *
 * @module
 */

import { createEngineLocal } from "../engine/engine-local.js";
import type { GwenEngine } from "../engine/engine-types.js";
import type { FrameMeter, SystemTiming } from "./timing.js";

const meters = createEngineLocal<FrameMeter>(() => ({
  on: false,
  pass: 0,
  frame: 0,
  now: () => 0,
}));

const records = createEngineLocal<Map<string, SystemTiming>>(() => new Map());

/** The engine's meter. The frame loop writes it. */
export function frameMeterOf(engine: GwenEngine): FrameMeter {
  return meters.get(engine);
}

/**
 * Start a pass. The next timed handler of every system starts from zero.
 * `frame` is the `lastRunFrame` value this pass will publish.
 * A stopped engine is left alone: this does not create a meter and does not throw.
 */
export function beginPass(engine: GwenEngine, frame: number, on: boolean, now: () => number): void {
  if (engine.disposables.closed) return;
  const meter = meters.get(engine);
  meter.pass += 1;
  meter.frame = frame;
  meter.on = on;
  meter.now = now;
}

/**
 * Write `on` when this engine already has a meter.
 * A stopped engine has none: this does not create one and does not throw.
 */
export function setPassOn(engine: GwenEngine, on: boolean): void {
  const meter = meters.peek(engine);
  if (meter !== undefined) meter.on = on;
}

/**
 * The record of system `id`, created on first install and kept when a hot
 * swap reuses that id.
 */
export function timingFor(engine: GwenEngine, id: string): SystemTiming {
  const map = records.get(engine);
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const created: SystemTiming = {
    meter: meters.get(engine),
    pass: 0,
    frame: 0,
    beforeUpdate: 0,
    update: 0,
    afterUpdate: 0,
    render: 0,
  };
  map.set(id, created);
  return created;
}

/** The record of system `id`, without creating one. */
export function peekTiming(engine: GwenEngine, id: string): SystemTiming | undefined {
  return records.peek(engine)?.get(id);
}

/** Forget the record of a system that left the engine. */
export function dropTiming(engine: GwenEngine, id: string): void {
  records.peek(engine)?.delete(id);
}
