import { PerformanceObserver } from "node:perf_hooks";

import { createRealEngine, type RealEngineHandle } from "../../tests/integration-wasm/harness";
import type { AllocPathName, AllocRunConfig } from "./evaluate-alloc-gate";

export interface AllocScenario {
  readonly name: AllocPathName;
  build(handle: RealEngineHandle, entities: number): Promise<void>;
}

const DT = 1 / 60;

function requireGc(): () => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== "function") {
    throw new Error("[ALLOC GATE] run via pnpm test:alloc (--expose-gc missing)");
  }
  return gc;
}

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function readGcStarts(entries: ArrayLike<{ startTime: number }>, into: number[]): void {
  for (let i = 0; i < entries.length; i++) into.push(entries[i]!.startTime);
}

/**
 * Bytes allocated per frame on one real `light` engine.
 * `dispose()` is not on the harness yet (#70); `engine.stop()` runs in `finally`.
 */
export async function measureFrameAllocations(
  scenario: AllocScenario,
  entities: number,
  cfg: AllocRunConfig,
): Promise<number> {
  const gc = requireGc();
  if (cfg.repeats < 5) {
    throw new Error(`[ALLOC GATE] ${scenario.name}: repeats must be >= 5`);
  }

  const handle = await createRealEngine({ variant: "light", maxEntities: 4096 });
  const gcStarts: number[] = [];
  const observer = new PerformanceObserver((list) => {
    readGcStarts(list.getEntries(), gcStarts);
  });

  try {
    observer.observe({ entryTypes: ["gc"] });
    await scenario.build(handle, entities);
    if (cfg.warmupFrames > 0) await handle.advance(cfg.warmupFrames, DT);

    const samples: number[] = [];
    for (let repeat = 0; repeat < cfg.repeats; repeat++) {
      gc();
      await flushMacrotask();
      gcStarts.length = 0;
      readGcStarts(observer.takeRecords(), gcStarts);
      gcStarts.length = 0;

      const t0 = performance.now();
      const h0 = process.memoryUsage().heapUsed;
      await handle.advance(cfg.frames, DT);
      const h1 = process.memoryUsage().heapUsed;
      const t1 = performance.now();

      await flushMacrotask();
      readGcStarts(observer.takeRecords(), gcStarts);
      let sawGc = false;
      for (let i = 0; i < gcStarts.length; i++) {
        const start = gcStarts[i]!;
        if (start >= t0 && start <= t1) {
          sawGc = true;
          break;
        }
      }
      if (!sawGc) samples.push((h1 - h0) / cfg.frames);
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
    observer.disconnect();
    await handle.engine.stop();
  }
}

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

/**
 * Generic heap window for #56 and #113.
 * The frame gate does not call this. A wrapper around `advance` moved
 * `pool.cycle` and `entity.index` over the recorded margin.
 * `--expose-gc` must already be set. This function does not turn it on.
 */
export async function measureAllocations(
  run: () => void | Promise<void>,
  opts: MeasureAllocOptions,
): Promise<AllocationReport> {
  if (!Number.isInteger(opts.warmup) || opts.warmup < 0) {
    throw new Error("[ALLOC GATE] measureAllocations: warmup must be >= 0");
  }
  if (!Number.isInteger(opts.ops) || opts.ops <= 0) {
    throw new Error("[ALLOC GATE] measureAllocations: ops must be > 0");
  }

  const gc = requireGc();

  const gcStarts: number[] = [];
  const observer = new PerformanceObserver((list) => {
    readGcStarts(list.getEntries(), gcStarts);
  });
  try {
    observer.observe({ entryTypes: ["gc"] });
    for (let i = 0; i < opts.warmup; i++) await run();

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

    gc();
    await flushMacrotask();
    return {
      allocatedBytes: h1 - h0,
      gcCount,
      retainedBytes: process.memoryUsage().heapUsed - h0,
      bytesPerOp: (h1 - h0) / opts.ops,
    };
  } finally {
    observer.disconnect();
  }
}
