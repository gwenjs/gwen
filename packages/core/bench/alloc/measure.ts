import { PerformanceObserver } from "node:perf_hooks";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import { createRealEngine, type RealEngineHandle } from "../../tests/integration-wasm/harness";
import type { AllocPathName, AllocRunConfig } from "./evaluate-alloc-gate";

export interface AllocScenario {
  readonly name: AllocPathName;
  build(handle: RealEngineHandle, entities: number): Promise<void>;
}

/**
 * One forced-GC window around a single `run`.
 * #56 and #113 should import this instead of copying the heap logic.
 * `warmup` invokes `run` before the window. `ops` only divides the byte delta:
 * the measured call is one shot, so the caller puts every op inside `run`.
 */
export interface AllocationReport {
  /** heapUsed after `run` minus heapUsed after the forced GC before `run`. */
  allocatedBytes: number;
  /** GC events whose start time falls inside the measured `run`. */
  gcCount: number;
  /** heapUsed after a forced GC following `run`, minus the pre-run baseline. */
  retainedBytes: number;
  /** `allocatedBytes / ops`. */
  bytesPerOp: number;
}

export interface MeasureAllocOptions {
  warmup: number;
  ops: number;
}

const DT = 1 / 60;

function gcFromGlobal(): (() => void) | undefined {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== "function") return undefined;
  return gc;
}

function resolveGc(): () => void {
  const direct = gcFromGlobal();
  if (direct !== undefined) return direct;
  setFlagsFromString("--expose-gc");
  const enabled: unknown = runInNewContext("gc");
  if (typeof enabled !== "function") {
    throw new Error("[ALLOC GATE] run via pnpm test:alloc (--expose-gc missing)");
  }
  return () => {
    enabled();
  };
}

/** The frame gate must fail closed when the process was not started with `--expose-gc`. */
function requireGc(): () => void {
  const gc = gcFromGlobal();
  if (gc === undefined) {
    throw new Error("[ALLOC GATE] run via pnpm test:alloc (--expose-gc missing)");
  }
  return gc;
}

function assertMeasureOpts(opts: MeasureAllocOptions): void {
  if (!Number.isInteger(opts.warmup) || opts.warmup < 0) {
    throw new Error("[ALLOC GATE] measureAllocations: warmup must be >= 0");
  }
  if (!Number.isInteger(opts.ops) || opts.ops <= 0) {
    throw new Error("[ALLOC GATE] measureAllocations: ops must be > 0");
  }
}

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function readGcStarts(entries: ArrayLike<{ startTime: number }>, into: number[]): void {
  for (let i = 0; i < entries.length; i++) into.push(entries[i]!.startTime);
}

interface SampleWindow {
  allocatedBytes: number;
  gcCount: number;
  heapBefore: number;
}

async function sampleWindow(
  run: () => void | Promise<void>,
  gc: () => void,
  observer: PerformanceObserver,
  gcStarts: number[],
): Promise<SampleWindow> {
  gc();
  await flushMacrotask();
  gcStarts.length = 0;
  readGcStarts(observer.takeRecords(), gcStarts);
  gcStarts.length = 0;

  const t0 = performance.now();
  const h0 = process.memoryUsage().heapUsed;
  await run();
  const h1 = process.memoryUsage().heapUsed;
  const t1 = performance.now();

  await flushMacrotask();
  readGcStarts(observer.takeRecords(), gcStarts);
  let gcCount = 0;
  for (let i = 0; i < gcStarts.length; i++) {
    const start = gcStarts[i]!;
    if (start >= t0 && start <= t1) gcCount += 1;
  }
  return { allocatedBytes: h1 - h0, gcCount, heapBefore: h0 };
}

export async function measureAllocations(
  run: () => void | Promise<void>,
  opts: MeasureAllocOptions,
): Promise<AllocationReport> {
  assertMeasureOpts(opts);
  const gc = resolveGc();
  const gcStarts: number[] = [];
  const observer = new PerformanceObserver((list) => {
    readGcStarts(list.getEntries(), gcStarts);
  });
  try {
    observer.observe({ entryTypes: ["gc"] });
    for (let i = 0; i < opts.warmup; i++) await run();
    const window = await sampleWindow(run, gc, observer, gcStarts);
    gc();
    await flushMacrotask();
    const retainedBytes = process.memoryUsage().heapUsed - window.heapBefore;
    return {
      allocatedBytes: window.allocatedBytes,
      gcCount: window.gcCount,
      retainedBytes,
      bytesPerOp: window.allocatedBytes / opts.ops,
    };
  } finally {
    observer.disconnect();
  }
}

/**
 * Bytes allocated per frame on one real `light` engine.
 * `dispose()` is not on the harness yet (#70); `engine.stop()` runs in `finally`.
 * Each repeat calls `measureAllocations` (warmup 0) and keeps the min GC-free sample.
 */
export async function measureFrameAllocations(
  scenario: AllocScenario,
  entities: number,
  cfg: AllocRunConfig,
): Promise<number> {
  requireGc();
  if (cfg.repeats < 5) {
    throw new Error(`[ALLOC GATE] ${scenario.name}: repeats must be >= 5`);
  }

  const handle = await createRealEngine({ variant: "light", maxEntities: 4096 });
  try {
    await scenario.build(handle, entities);
    if (cfg.warmupFrames > 0) await handle.advance(cfg.warmupFrames, DT);

    const samples: number[] = [];
    for (let repeat = 0; repeat < cfg.repeats; repeat++) {
      const report = await measureAllocations(() => handle.advance(cfg.frames, DT), {
        warmup: 0,
        ops: cfg.frames,
      });
      if (report.gcCount === 0) samples.push(report.bytesPerOp);
    }

    if (samples.length < 3) {
      // eslint-disable-next-line no-console -- names how many GC-free samples were kept
      console.error(
        `[ALLOC GATE] ${scenario.name}: ${String(samples.length)} GC-free samples of ${String(cfg.repeats)}`,
      );
      throw new Error(`[ALLOC GATE] ${scenario.name}: unstable (GC in every sample)`);
    }
    let min = samples[0]!;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i]! < min) min = samples[i]!;
    }
    return min;
  } finally {
    await handle.engine.stop();
  }
}
