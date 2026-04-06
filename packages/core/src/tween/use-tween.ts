/**
 * @file RFC-03 — useTween composable
 *
 * Provides the {@link useTween} composable for animating values from within
 * engine contexts such as `defineSystem()`, `defineActor()`, or `engine.run()`.
 *
 * @since 1.0.0
 */

import { useEngine } from '../context.js';
import { getTweenManager } from './tween-manager.js';
import type { TweenableValue, TweenOptions, TweenHandle } from './tween-types.js';

// ── useTween ──────────────────────────────────────────────────────────────────

/**
 * Returns a tween handle for animating a value of type T over time.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `defineActor()`, or `engine.run()`).
 *
 * The returned handle is backed by a slot from the engine's {@link TweenPool}.
 * The slot is **not** automatically released when the calling scope ends — for
 * now, call `manager.release(slot)` manually when the tween is no longer
 * needed. Automatic lifecycle cleanup will be handled in T5 via a Vite plugin.
 *
 * @typeParam T - The type of value to animate: `number`, `Vec2`, `Vec3`, or `Color`.
 * @param options - Tween configuration (duration, easing, loop, yoyo).
 * @returns A {@link TweenHandle} bound to the current engine's tween pool.
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example
 * ```typescript
 * const fade = useTween<number>({ duration: 0.4, easing: 'easeOutQuad' })
 * fade.play({ from: 1, to: 0 })
 * fade.onComplete(() => actor.destroy())
 * ```
 *
 * @since 1.0.0
 */
export function useTween<T extends TweenableValue>(options: TweenOptions<T>): TweenHandle<T> {
  const engine = useEngine();
  const manager = getTweenManager(engine);
  const slot = manager.claim(options as TweenOptions<TweenableValue>);
  return slot as unknown as TweenHandle<T>;
}
