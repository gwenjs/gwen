/**
 * Returns `specMs * multiplier` when running in CI, otherwise `specMs`.
 * Use this for all timing-based performance assertions so spec values remain
 * readable while CI runners (which are slower) get appropriate headroom.
 *
 * @example
 * expect(elapsed).toBeLessThan(ciThreshold(5))       // 5ms local, 50ms CI
 * expect(elapsed).toBeLessThan(ciThreshold(0.5, 20)) // 0.5ms local, 10ms CI
 */
export function ciThreshold(specMs: number, multiplier = 10): number {
  return process.env.CI ? specMs * multiplier : specMs;
}
