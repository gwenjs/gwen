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
import type { GwenEngine } from "../../engine/gwen-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Options for {@link watchActorLeaks}.
 */
export interface WatchActorLeaksOptions {
  /** How often to poll, in ms. Ignored when `engine` is provided. @default 5_000 */
  intervalMs?: number;
  /**
   * Number of consecutive growth observations before a leak is reported.
   * @default 3
   */
  growthStreak?: number;
  /** Called when a leak is detected. Defaults to `console.warn`. */
  onLeak?: (name: string, count: number, delta: number) => void;
  /**
   * When provided, detection is driven by the engine's `engine:afterTick` hook
   * instead of `setInterval`. This eliminates false positives from burst-spawn
   * patterns and ensures checks are synchronised with the game loop.
   *
   * **Preferred over `intervalMs`** in any context where an engine instance is
   * available (systems, scene callbacks, tests).
   *
   * @example
   * ```ts
   * watchActorLeaks([BulletActor, EnemyActor], { engine });
   * ```
   */
  engine?: GwenEngine;
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
  const { intervalMs = 5_000, growthStreak = 3, onLeak = defaultLeak, engine } = options;

  const prevCounts = new Map<string, number>();
  const streaks = new Map<string, number>();

  for (const def of actorDefs) {
    prevCounts.set(def.__actorName__, def._instances.size);
  }

  /**
   * Single observation tick — compare current counts against the last snapshot
   * and report actors whose count has grown for `growthStreak` consecutive ticks.
   */
  function tick(): void {
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
        streaks.set(name, 0);
      }

      prevCounts.set(name, count);
    }
  }

  if (engine) {
    // Hook-based: synchronised with the game loop — no false positives from bursts.
    const unsub = engine.hooks.hook("engine:afterTick", tick);
    // Auto-unsubscribe when the engine stops so callers don't need to save the return value.
    const stopOnEngineStop = engine.hooks.hook("engine:stop", () => {
      unsub();
      stopOnEngineStop();
    });
    return () => {
      unsub();
      stopOnEngineStop();
    };
  }

  // Fallback: polling via setInterval when no engine is available.
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
