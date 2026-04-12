/**
 * @file watchActorLeaks — dev-time actor instance leak detector.
 *
 * Polls a set of actor definitions at a fixed interval and emits a console
 * warning when an actor's live instance count grows continuously without ever
 * decreasing, which is the classic signature of spawn-without-despawn bugs.
 *
 * @example
 * ```ts
 * // main.ts — only in development
 * if (import.meta.env.DEV) {
 *   watchActorLeaks([PlayerActor, EnemyActor, BulletActor])
 * }
 * ```
 *
 * @example With custom options
 * ```ts
 * const stop = watchActorLeaks([BulletActor], {
 *   intervalMs: 3_000,
 *   growthStreak: 2,
 *   onLeak: (name, count, delta) => myTelemetry.warn('actor-leak', { name, count, delta }),
 * })
 *
 * // Later — stop monitoring (e.g. before engine teardown in tests)
 * stop()
 * ```
 */

import type { ActorDefinition } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Options for {@link watchActorLeaks}.
 */
export interface WatchActorLeaksOptions {
  /**
   * How often to poll instance counts, in milliseconds.
   * @default 5_000
   */
  intervalMs?: number;

  /**
   * Number of consecutive growth observations required before a leak is
   * reported. A value of `2` means the count must have grown in 2 consecutive
   * polling intervals (i.e. for at least `2 × intervalMs` ms without any
   * decrease).
   *
   * Increase this to suppress false positives during burst-spawn patterns.
   * @default 3
   */
  growthStreak?: number;

  /**
   * Called when a leak is detected.
   *
   * Defaults to a `console.warn` that includes the actor name, current count,
   * and the number of instances added since the last observation.
   *
   * @param name   - Actor name (from `__actorName__`).
   * @param count  - Current live instance count.
   * @param delta  - Instances added since the last poll.
   */
  onLeak?: (name: string, count: number, delta: number) => void;
}

// ─── Default reporter ─────────────────────────────────────────────────────────

function defaultLeak(name: string, count: number, delta: number): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[GWEN] Possible actor leak detected: "${name}" has ${count} live instances ` +
      `(+${delta} since last check). Call despawn() or despawnAll() when done, ` +
      `or add onExit(() => actor.despawnAll()) to the enclosing scene.`,
  );
}

// ─── watchActorLeaks ──────────────────────────────────────────────────────────

/**
 * Start polling the given actor definitions for unbounded instance growth.
 *
 * Safe to call unconditionally — wrap in `if (import.meta.env.DEV)` to
 * tree-shake it out of production bundles.
 *
 * @param actorDefs - Actor definitions to monitor. Pass every actor type whose
 *   lifecycle you want to verify.
 * @param options   - Polling interval, streak threshold, and optional custom
 *   reporter. See {@link WatchActorLeaksOptions}.
 * @returns A `stop` function — call it to cancel the interval (e.g. in test
 *   `afterEach` or before engine teardown).
 */
export function watchActorLeaks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actorDefs: ActorDefinition<any, any>[],
  options: WatchActorLeaksOptions = {},
): () => void {
  const { intervalMs = 5_000, growthStreak = 3, onLeak = defaultLeak } = options;

  const prevCounts = new Map<string, number>();
  const streaks = new Map<string, number>();

  // Capture baseline immediately at call time so that any growth observed on
  // the first interval tick already counts toward the streak.
  for (const def of actorDefs) {
    prevCounts.set(def.__actorName__, def._instances.size);
  }

  const id = setInterval(() => {
    for (const def of actorDefs) {
      const name = def.__actorName__;
      const count = def._instances.size;
      const prev = prevCounts.get(name)!;

      if (count > prev) {
        const streak = (streaks.get(name) ?? 0) + 1;
        streaks.set(name, streak);
        if (streak >= growthStreak) {
          onLeak(name, count, count - prev);
        }
      } else {
        // count stable or decreased — reset the growth streak
        streaks.set(name, 0);
      }

      prevCounts.set(name, count);
    }
  }, intervalMs);

  return () => clearInterval(id);
}
