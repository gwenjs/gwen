/**
 * @file RFC-03 — defineSequence factory
 *
 * Provides the {@link defineSequence} factory for composing multiple tween
 * animations and timed delays into a single ordered sequence.
 *
 * @since 1.0.0
 */

import { useEngine } from '../context.js';
import { getTweenManager } from './tween-manager.js';
import { TweenSlot } from './tween-pool.js';
import type { SequenceHandle, SequenceStep, TweenableValue } from './tween-types.js';

// ── defineSequence ────────────────────────────────────────────────────────────

/**
 * Creates a {@link SequenceHandle} that plays a series of tween animations
 * and/or timed waits in order.
 *
 * Must be called inside an active engine context (inside `defineSystem()`,
 * `defineActor()`, or `engine.run()`) because it allocates tween slots from
 * the engine's {@link TweenPool} to implement `{ wait }` steps.
 *
 * **Step types:**
 * - `{ tween, from, to }` — plays an existing {@link TweenHandle} from `from`
 *   to `to` and advances to the next step when the tween completes.
 * - `{ wait }` — pauses the sequence for `wait` seconds using a freshly
 *   claimed pool slot that is released immediately after it completes.
 *
 * **Notes:**
 * - **Calling `sequence.play()` internally calls `tween.play()` on each step,
 *   which clears any previously registered `onComplete` callbacks on the tween
 *   handle.** Register `onComplete` on the sequence itself (via
 *   `sequence.onComplete()`), not on individual tween handles.
 * - Calling `play()` while the sequence is already running restarts it from
 *   step 0.
 * - Each `{ wait }` step claims one pool slot for its duration and releases it
 *   when complete, so no slots are held between steps.
 *
 * @param steps - Ordered list of {@link SequenceStep} entries to execute.
 * @returns A {@link SequenceHandle} with `play`, `pause`, `reset`, and
 *          `onComplete` methods.
 * @throws {GwenContextError} If called outside an active engine context.
 *
 * @example
 * ```typescript
 * const seq = defineSequence([
 *   { tween: fadeIn,  from: 0, to: 1   },
 *   { wait: 0.5 },
 *   { tween: moveX,   from: 0, to: 200 },
 *   { tween: fadeOut, from: 1, to: 0   },
 * ])
 *
 * seq.play()
 * seq.onComplete(() => console.log('sequence done'))
 * ```
 *
 * @since 1.0.0
 */
export function defineSequence(steps: SequenceStep[]): SequenceHandle {
  const engine = useEngine();
  const manager = getTweenManager(engine);

  // ── Internal state ──────────────────────────────────────────────────────────

  /** Index of the step currently running or about to run next. */
  let _currentStep = 0;

  /** Whether the sequence is actively progressing through steps. */
  let _playing = false;

  /** The active wait slot currently executing (if any), or null. */
  let _activeWaitSlot: TweenSlot | null = null;

  /** Registered completion callbacks — fired once when all steps finish. */
  const _completeCbs: Array<() => void> = [];

  // ── Step runner ─────────────────────────────────────────────────────────────

  /**
   * Execute the step at `index`.
   *
   * When the step finishes it recursively calls itself with `index + 1`,
   * forming a lightweight completion-callback chain.  When `index` is past the
   * end of the steps array the sequence is marked as done and all registered
   * `onComplete` callbacks are fired.
   *
   * For `{ wait }` steps a temporary pool slot is claimed just-in-time and
   * released as soon as the wait completes, keeping pool pressure minimal.
   *
   * @param index - Zero-based index of the step to run.
   */
  function _runStep(index: number): void {
    // All steps have finished.
    if (index >= steps.length) {
      _playing = false;
      for (let i = 0; i < _completeCbs.length; i++) {
        _completeCbs[i]!();
      }
      return;
    }

    _currentStep = index;
    const step = steps[index]!;

    if ('wait' in step) {
      // ── Wait step ────────────────────────────────────────────────────────────
      //
      // Claim a temporary number tween for the wait duration (0 → 1).
      // Store the slot on the instance so pause()/reset() can access it.
      // The slot is released immediately after completion so it returns to
      // the pool without occupying a slot between steps.
      const waitDuration = step.wait;
      // Policy is 'grow' (default) or 'throw' in typical engine usage.
      // Under 'drop' policy with an exhausted pool, claim() returns null and the
      // sequence will crash — callers must not use 'drop' policy with defineSequence.
      _activeWaitSlot = manager.claim({ duration: waitDuration })!;
      _activeWaitSlot.play({ from: 0 as TweenableValue, to: 1 as TweenableValue });
      _activeWaitSlot.onComplete(() => {
        manager.release(_activeWaitSlot!);
        _activeWaitSlot = null;
        // Guard: only advance if the sequence is still playing (not paused/reset).
        if (_playing) {
          _runStep(index + 1);
        }
      });
    } else {
      // ── Tween step ───────────────────────────────────────────────────────────
      step.tween.play({ from: step.from, to: step.to });
      step.tween.onComplete(() => {
        if (_playing) {
          _runStep(index + 1);
        }
      });
    }
  }

  // ── Public handle ────────────────────────────────────────────────────────────

  const handle: SequenceHandle = {
    /**
     * Start playing the sequence from step 0.
     *
     * If the sequence is already playing it is restarted from the beginning.
     *
     * @since 1.0.0
     */
    play(): void {
      _playing = true;
      _currentStep = 0;
      _runStep(0);
    },

    /**
     * Pause the currently executing tween or wait step.
     *
     * Sets `_playing` to `false` so in-flight completion callbacks will not
     * advance to the next step. The active tween step (if any) is also paused
     * on its handle. If a wait step is active, it is paused as well.
     *
     * @since 1.0.0
     */
    pause(): void {
      _playing = false;
      const step = steps[_currentStep];
      if (step !== undefined && 'tween' in step) {
        step.tween.pause();
      }
      if (_activeWaitSlot) {
        _activeWaitSlot.pause();
      }
    },

    /**
     * Reset the sequence to step 0 without starting playback.
     *
     * Also resets the active tween step (if any) back to its initial state.
     * If a wait step is active, it is paused and its slot is released back to
     * the pool.
     *
     * @since 1.0.0
     */
    reset(): void {
      _playing = false;
      const step = steps[_currentStep];
      if (step !== undefined && 'tween' in step) {
        step.tween.reset();
      }
      if (_activeWaitSlot) {
        _activeWaitSlot.pause();
        manager.release(_activeWaitSlot);
        _activeWaitSlot = null;
      }
      _currentStep = 0;
    },

    /**
     * Register a callback that fires when all steps have completed.
     *
     * Multiple callbacks may be registered; they are invoked in registration
     * order after the final step finishes.
     *
     * @param cb - Zero-argument callback function.
     * @since 1.0.0
     */
    onComplete(cb: () => void): void {
      _completeCbs.push(cb);
    },
  };

  return handle;
}
