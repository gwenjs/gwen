/**
 * Returns `specMs * multiplier` when running in CI, otherwise `specMs`.
 * Use this for all timing-based performance assertions so spec values remain
 * readable while CI runners (which are slower) get appropriate headroom.
 *
 * @example
 * expect(elapsed).toBeLessThan(ciThreshold(5))       // 5ms local, 50ms CI
 * expect(elapsed).toBeLessThan(ciThreshold(0.5, 40)) // 0.5ms local, 20ms CI
 */
export function ciThreshold(specMs: number, multiplier = 10): number {
  return process.env.CI ? specMs * multiplier : specMs;
}

/** Result of {@link measureMedianMs}. */
export interface TimingSample {
  /** Median of the measured runs, in milliseconds. */
  readonly medianMs: number;
  /** Slowest measured run, in milliseconds. */
  readonly maxMs: number;
}

/**
 * Times `run` several times and returns the median and the slowest run.
 *
 * `prepare` runs before each sample, outside the timed region, and returns the
 * input for `run`. A few warm-up runs happen first so JIT compilation does not
 * land in the samples. The median ignores a single slow run caused by GC or a
 * busy runner, which a one-shot measurement does not.
 */
export function measureMedianMs<T>(
  prepare: () => T,
  run: (input: T) => void,
  samples = 21,
  warmup = 3,
): TimingSample {
  for (let i = 0; i < warmup; i++) run(prepare());
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const input = prepare();
    const start = performance.now();
    run(input);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return {
    medianMs: times[Math.floor(times.length / 2)] ?? 0,
    maxMs: times[times.length - 1] ?? 0,
  };
}

/**
 * Prints one timing line to the bench output so CI logs keep the numbers,
 * then returns the median for the budget assertion.
 */
export function reportTiming(name: string, sample: TimingSample, budgetMs: number): number {
  console.log(
    `[timing-gate] ${name}: median ${sample.medianMs.toFixed(4)} ms, ` +
      `max ${sample.maxMs.toFixed(4)} ms, budget ${budgetMs} ms`,
  );
  return sample.medianMs;
}
