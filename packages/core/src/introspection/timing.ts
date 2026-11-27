/**
 * @file Per-system handler timing. Dev only: every use sits under `if (__GWEN_DEV__)`.
 *
 * The frame loop writes one {@link FrameMeter} per engine from its `instrument`
 * flag. The `ScopedHookable` wrapper reads that meter. It never reads `debug`.
 *
 * `frame` is the `frameCount` the pass completes as. A step stores
 * `frameCount + 1`. A display frame with no step stores the current
 * `frameCount`, and one that already stepped adds its render time to the last
 * step's record. A new pass replaces the four phase sums. Handlers of one
 * phase add. A throw still records the synchronous part. An isolated system
 * keeps reading 0 ms with a current `lastRunFrame`.
 *
 * @module
 */

/** Per-engine flag and counters the frame loop writes. */
export interface FrameMeter {
  /** True while a pass runs with the engine's `instrument` flag set. */
  on: boolean;
  /** Bumped by each pass. A record whose `pass` differs starts from zero. */
  pass: number;
  /** The `lastRunFrame` value of the current pass. */
  frame: number;
  /**
   * The clock, handed over by the frame loop. `performance.now()` stays in
   * `engine-loop.ts`. This module never reads the clock itself.
   */
  now: () => number;
}

/** What one system measured in its latest pass. */
export interface SystemTiming {
  readonly meter: FrameMeter;
  /** Pass this record currently describes. `0` means it has never run. */
  pass: number;
  /** `lastRunFrame` for `pass`. */
  frame: number;
  beforeUpdate: number;
  update: number;
  afterUpdate: number;
  render: number;
}

type Fire = (...args: unknown[]) => unknown;

function call(fire: Fire, a: unknown, b: unknown, c: unknown, d: unknown): unknown {
  if (d !== undefined) return fire(a, b, c, d);
  if (c !== undefined) return fire(a, b, c);
  if (b !== undefined) return fire(a, b);
  if (a !== undefined) return fire(a);
  return fire();
}

/** A new pass replaces the four sums. The same pass adds. */
function add(timing: SystemTiming, hook: string, ms: number): void {
  const meter = timing.meter;
  if (timing.pass !== meter.pass) {
    timing.pass = meter.pass;
    timing.frame = meter.frame;
    timing.beforeUpdate = 0;
    timing.update = 0;
    timing.afterUpdate = 0;
    timing.render = 0;
  }
  if (hook === "engine:before-update") timing.beforeUpdate += ms;
  else if (hook === "engine:update") timing.update += ms;
  else if (hook === "engine:after-update") timing.afterUpdate += ms;
  else timing.render += ms;
}

/**
 * Run one handler and add the time of its synchronous part to `timing`, also
 * when it throws. The wrapper calls this for every hook while
 * `timing.meter.on` is true. Only the four frame phases are timed. Any other
 * hook runs untimed.
 */
export function fireTimed(
  hook: string,
  timing: SystemTiming,
  fire: Fire,
  a: unknown,
  b: unknown,
  c: unknown,
  d: unknown,
): unknown {
  if (
    hook !== "engine:before-update" &&
    hook !== "engine:update" &&
    hook !== "engine:after-update" &&
    hook !== "engine:render"
  ) {
    return call(fire, a, b, c, d);
  }
  const t0 = timing.meter.now();
  try {
    return call(fire, a, b, c, d);
  } finally {
    add(timing, hook, timing.meter.now() - t0);
  }
}
