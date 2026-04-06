/**
 * Per-engine singleton manager for tween animations.
 *
 * Holds a {@link TweenPool} and registers an `engine:tick` hook to advance
 * all active tweens each frame. Provides the {@link getTweenManager} factory.
 *
 * @since 1.0.0
 */

import { useEngine } from '../context.js';
import type { GwenEngine } from '../engine/gwen-engine.js';
import type { TweenOptions, TweenableValue } from './tween-types.js';
import { TweenPool, type TweenSlot } from './tween-pool.js';
import type { TweenPoolPolicy } from './tween-pool.js';
import type { GwenLogger } from '../logger/types.js';

// ── Cache symbol ────────────────────────────────────────────────────────────

/**
 * Symbol used to cache {@link TweenManager} instances on engine objects.
 * Follows the same pattern as the scene router cache.
 *
 * @internal
 */
const TWEEN_MANAGER_KEY = Symbol('gwen.tweenManager');

// ── TweenManager ─────────────────────────────────────────────────────────────

/**
 * Per-engine singleton that manages tween animations.
 *
 * Holds a {@link TweenPool} of reusable tween slots and advances them
 * each frame via an `engine:tick` hook. Actors call {@link getTweenManager}
 * to get the shared instance.
 *
 * @example
 * ```typescript
 * const manager = getTweenManager(engine);
 * const slot = manager.claim({ duration: 2.0, easing: 'easeInCubic' });
 * slot.play({ from: 0, to: 100 });
 * // slot.tick() is called automatically each frame
 * // When done:
 * manager.release(slot);
 * ```
 *
 * @since 1.0.0
 */
export class TweenManager {
  private _pool: TweenPool;
  private _unregister: (() => void) | null = null;

  /**
   * Create a new TweenManager for the given engine.
   *
   * Automatically registers an `engine:tick` hook to advance all tweens.
   * This is typically called once per engine via {@link getTweenManager}.
   *
   * @param engine - The GWEN engine instance
   * @param poolSize - Number of tween slots to pre-allocate (default: 256)
   * @param policy - Growth / exhaustion policy for the underlying {@link TweenPool}
   * @param logger - Optional structured logger for capacity warnings
   * @since 1.0.0
   */
  constructor(
    engine: GwenEngine,
    poolSize: number = 256,
    policy?: TweenPoolPolicy,
    logger?: GwenLogger,
  ) {
    this._pool = new TweenPool(poolSize, policy, logger);

    // Register the tick hook on the engine
    // The hook fires at the start of every frame with the delta time
    this._unregister = engine.hooks.hook('engine:tick', (dt: number) => {
      this._tick(dt);
    });
  }

  /**
   * Claim a tween slot from the pool and configure it.
   *
   * The returned slot is not yet playing — call {@link TweenHandle.play}
   * to start the animation.
   *
   * Returns `null` when the pool policy is `'drop'` and all slots are in use.
   * In all other cases either a slot is returned or an error is thrown.
   *
   * @param options - Tween configuration (duration, easing, loop, yoyo)
   * @returns A configured tween slot ready to play, or `null` when policy is `'drop'`
   * @throws {GwenConfigError} If the pool is exhausted and the policy is `'throw'`
   *   or `'grow'` but `maxSize` has been reached.
   * @since 1.0.0
   */
  claim(options: TweenOptions<TweenableValue>): TweenSlot | null {
    return this._pool.claim(options);
  }

  /**
   * Release a tween slot back to the pool.
   *
   * Called automatically when an actor is despawned, or manually when
   * a tween is no longer needed.
   *
   * @param slot - The slot to release
   * @since 1.0.0
   */
  release(slot: TweenSlot): void {
    this._pool.release(slot);
  }

  /**
   * Unregister the tick hook from the engine.
   * Called by the engine when it shuts down.
   *
   * @internal
   */
  _shutdown(): void {
    if (this._unregister) {
      this._unregister();
      this._unregister = null;
    }
  }

  /**
   * Advance all active tween slots by `dt`.
   * Delegates to {@link TweenPool.tick} to tick all active slots.
   * Called automatically via the `engine:tick` hook each frame.
   *
   * @param dt - Time delta in seconds
   * @internal
   */
  private _tick(dt: number): void {
    this._pool.tick(dt);
  }
}

// ── Factory function ────────────────────────────────────────────────────────

/**
 * Get or create the {@link TweenManager} singleton for the given engine.
 *
 * Returns the same instance on subsequent calls (singleton pattern).
 * The manager is cached on the engine object itself using a Symbol.
 *
 * @param engine - The GWEN engine instance
 * @returns The singleton TweenManager for this engine
 * @throws If called outside an active engine context and engine is not provided
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // Inside an actor or system:
 * const manager = getTweenManager(engine);
 * const tween = manager.claim({ duration: 2.0, easing: 'easeOutQuad' });
 * ```
 */
export function getTweenManager(engine?: GwenEngine): TweenManager {
  let resolvedEngine: GwenEngine;

  // If engine not provided, try to get it from context
  if (!engine) {
    try {
      resolvedEngine = useEngine() as GwenEngine;
    } catch {
      throw new Error(
        '[GWEN] getTweenManager() requires an engine instance or an active engine context (inside engine.run(), defineActor(), defineSystem(), etc.)',
      );
    }
  } else {
    resolvedEngine = engine;
  }

  // Check if manager already exists on engine
  const cached = (resolvedEngine as unknown as Record<symbol, unknown>)[TWEEN_MANAGER_KEY];
  if (cached instanceof TweenManager) {
    return cached;
  }

  // Create and cache new manager
  const manager = new TweenManager(
    resolvedEngine,
    resolvedEngine.tweenPoolSize,
    resolvedEngine.tweenPoolPolicy,
    resolvedEngine.logger.child('@gwenjs/core/tween'),
  );
  (resolvedEngine as unknown as Record<symbol, unknown>)[TWEEN_MANAGER_KEY] = manager;

  return manager;
}
