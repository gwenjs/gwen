/**
 * GWEN Tween & Animation System — type definitions.
 *
 * Defines the core types and interfaces for tweens and animation sequences.
 * Used by the {@link useTween} hook and tween manager.
 *
 * @since 1.0.0
 */

import type { Vec2, Vec3, Color } from '@gwenjs/math';
import type { EasingName } from './easing.js';

export type { EasingName };

// ── Core Types ───────────────────────────────────────────────────────────────

/**
 * A value type that can be animated by tweens.
 * Supports scalar numbers and 2D/3D vectors and RGBA colors.
 *
 * @since 1.0.0
 */
export type TweenableValue = number | Vec2 | Vec3 | Color;

// ── TweenOptions ─────────────────────────────────────────────────────────────

/**
 * Configuration for a tween animation.
 *
 * @typeParam T - The type of value being animated (number, Vec2, Vec3, or Color)
 *
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const opts: TweenOptions<number> = {
 *   duration: 2.0,
 *   easing: 'easeInCubic',
 *   loop: true,
 *   yoyo: true,
 * };
 * ```
 */
export interface TweenOptions<_T extends TweenableValue> {
  /**
   * Duration of the tween in seconds.
   * Must be a positive number. Required.
   *
   * @since 1.0.0
   */
  duration: number;

  /**
   * Easing function to apply to the animation.
   * Can be an easing function name (string) or a custom function.
   * Signature: `(t: number) => number` where t ∈ [0, 1].
   *
   * @default 'linear'
   * @since 1.0.0
   */
  easing?: EasingName | ((t: number) => number);

  /**
   * When true, the tween repeats infinitely after reaching the end.
   *
   * @default false
   * @since 1.0.0
   */
  loop?: boolean;

  /**
   * When true, the tween reverses direction after reaching the end,
   * playing back to the start. Alternates on each cycle if combined with loop.
   *
   * @default false
   * @since 1.0.0
   */
  yoyo?: boolean;
}

// ── TweenHandle ──────────────────────────────────────────────────────────────

/**
 * Runtime handle for a tween animation.
 *
 * Returned by {@link useTween}, provides control and state inspection.
 *
 * @typeParam T - The type of value being animated (number, Vec2, Vec3, or Color)
 *
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const tween = useTween<number>(options);
 * tween.play({ from: 0, to: 100 });
 * console.log(tween.value);       // Current value
 * console.log(tween.playing);     // Is it animating?
 *
 * tween.onComplete(() => {
 *   console.log('Animation finished');
 * });
 * ```
 */
export interface TweenHandle<T extends TweenableValue> {
  /**
   * Current interpolated value of the tween.
   * Updated automatically each frame while playing via {@link tick}.
   * Updated immediately when {@link play} is called.
   *
   * @readonly
   * @since 1.0.0
   */
  readonly value: T;

  /**
   * Whether the tween is currently animating (advancing each frame).
   * True between {@link play} and when the animation ends.
   * False after {@link pause} or {@link reset}.
   *
   * @readonly
   * @since 1.0.0
   */
  readonly playing: boolean;

  /**
   * Start animating from `from` to `to`.
   * Can be called while a tween is already playing (restarts the animation).
   * Immediately updates {@link value} to match `from`.
   * Sets {@link playing} to true.
   *
   * @param targets - Animation targets: `{ from: T; to: T }`
   * @since 1.0.0
   */
  play(targets: { from: T; to: T }): void;

  /**
   * Pause the tween at its current position.
   * Sets {@link playing} to false, preserves {@link value}.
   * Can be resumed with {@link resume}.
   *
   * @since 1.0.0
   */
  pause(): void;

  /**
   * Resume animation from the current {@link value} after a {@link pause}.
   * Sets {@link playing} to true.
   * Has no effect if the tween is already playing or has completed.
   *
   * @since 1.0.0
   */
  resume(): void;

  /**
   * Stop and reset the tween to its initial `from` value.
   * Sets {@link playing} to false.
   * Must have called {@link play} at least once before calling reset.
   *
   * @since 1.0.0
   */
  reset(): void;

  /**
   * Register a callback fired when the tween reaches the end of a cycle.
   * For looping tweens, fires at the end of each cycle.
   * For non-looping tweens, fires exactly once.
   * Callbacks are invoked before the next {@link tick}.
   *
   * @param cb - Callback function (no arguments)
   * @since 1.0.0
   */
  onComplete(cb: () => void): void;

  /**
   * Advance the tween by `dt` seconds.
   * Called automatically by the tween manager each frame.
   * Updates {@link value} and fires {@link onComplete} callbacks when cycles finish.
   *
   * @param dt - Time delta in seconds (typically < 0.1)
   * @since 1.0.0
   */
  tick(dt: number): void;
}

// ── Sequence ─────────────────────────────────────────────────────────────────

/**
 * A single step in a tween sequence.
 * Either a tween animation or a wait delay.
 *
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const step1: SequenceStep = {
 *   tween: myTween,
 *   from: 0,
 *   to: 100,
 * };
 *
 * const step2: SequenceStep = { wait: 1.5 };
 * ```
 */
export type SequenceStep =
  | {
      /** Tween to play for this step. */
      tween: TweenHandle<TweenableValue>;
      /** Starting value for the tween. */
      from: TweenableValue;
      /** Target value for the tween. */
      to: TweenableValue;
    }
  | {
      /** Wait duration in seconds. */
      wait: number;
    };

/**
 * Runtime handle for a sequence of tweens and delays.
 *
 * A sequence plays multiple tweens in order, with optional delays between them.
 *
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const sequence = useSequence([
 *   { tween: tween1, from: 0, to: 100 },
 *   { wait: 0.5 },
 *   { tween: tween2, from: 100, to: 50 },
 * ]);
 *
 * sequence.play();
 * sequence.onComplete(() => console.log('Sequence done'));
 * ```
 */
export interface SequenceHandle {
  /**
   * Start playing the sequence from the beginning.
   * Starts the first step if one exists.
   *
   * @since 1.0.0
   */
  play(): void;

  /**
   * Pause the sequence at its current step.
   * Can be resumed with {@link play} to continue from the current position.
   *
   * @since 1.0.0
   */
  pause(): void;

  /**
   * Reset the sequence to the beginning.
   * Does not start playing — must call {@link play} to resume.
   *
   * @since 1.0.0
   */
  reset(): void;

  /**
   * Register a callback fired when the sequence completes all steps.
   *
   * @param cb - Callback function (no arguments)
   * @since 1.0.0
   */
  onComplete(cb: () => void): void;
}
