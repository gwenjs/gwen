/**
 * @file RFC-03 — defineSequence unit tests
 *
 * Verifies:
 * - Steps execute in order (tween steps)
 * - { wait: N } delays correctly
 * - onComplete fires once at end of sequence
 * - pause() during a tween step pauses it
 * - pause() during a wait step pauses the wait
 * - reset() stops execution and returns to step 0
 * - play() after reset() restarts from beginning
 * - empty steps array: onComplete fires immediately on play()
 */

import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../../src/index';
import { useTween } from '../../src/tween/use-tween';
import { defineSequence } from '../../src/tween/define-sequence';
import { getTweenManager } from '../../src/tween/tween-manager';

// ── Steps execute in order ────────────────────────────────────────────────────

describe('defineSequence() step ordering', () => {
  it('steps execute in order: first tween then second tween', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 0.5, easing: 'linear' });

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.play();
      // seq.play() calls tween1.play() which clears callbacks.
      // Register AFTER seq.play() to avoid being wiped.
      const order: number[] = [];
      tween1.onComplete(() => order.push(1));

      // Tick through first step — tween1 completes, sequence starts tween2
      tween1.tick(0.5);

      // Now register tween2's callback (tween2.play() was called during tween1's onComplete)
      tween2.onComplete(() => order.push(2));

      // Tick through second step
      tween2.tick(0.5);

      expect(order).toEqual([1, 2]);
    });
  });

  it('second tween starts with correct from/to values', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 1.0, easing: 'linear' });

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 50 },
        { tween: tween2, from: 50, to: 100 },
      ]);

      seq.play();
      tween1.tick(0.5); // finishes step 1
      // Step 2 now started — value should be 50
      expect(tween2.value).toBe(50);
      tween2.tick(0.5);
      // Halfway through step 2
      expect(tween2.value).toBeCloseTo(75, 2);
    });
  });

  it('three-step sequence executes all steps', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tweens = [
        useTween<number>({ duration: 0.1, easing: 'linear' }),
        useTween<number>({ duration: 0.1, easing: 'linear' }),
        useTween<number>({ duration: 0.1, easing: 'linear' }),
      ];
      const completedSteps: number[] = [];

      const seq = defineSequence([
        { tween: tweens[0]!, from: 0, to: 1 },
        { tween: tweens[1]!, from: 1, to: 2 },
        { tween: tweens[2]!, from: 2, to: 3 },
      ]);

      seq.play();

      tweens[0]!.tick(0.1);
      completedSteps.push(0);

      tweens[1]!.tick(0.1);
      completedSteps.push(1);

      tweens[2]!.tick(0.1);
      completedSteps.push(2);

      expect(completedSteps).toEqual([0, 1, 2]);
      expect(tweens[2]!.value).toBeCloseTo(3, 3);
    });
  });
});

// ── { wait: N } delay step ────────────────────────────────────────────────────

describe('defineSequence() wait steps', () => {
  it('wait step delays the next tween from starting', async () => {
    const engine = await createEngine({ maxEntities: 100 });

    let tween2Started = false;
    let capturedTween2: ReturnType<typeof useTween<number>> | null = null;

    engine.run(() => {
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 0.5, easing: 'linear' });
      capturedTween2 = tween2;

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { wait: 0.5 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.play();

      // Complete step 1
      tween1.tick(0.5);

      // tween2 should NOT be playing yet — wait step is active
      expect(tween2.playing).toBe(false);
      tween2Started = tween2.playing;
    });

    expect(tween2Started).toBe(false);
    expect(capturedTween2).not.toBeNull();
    expect(capturedTween2!.playing).toBe(false);
  });

  it('wait step triggers next tween after its duration elapses via pool tick', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const manager = getTweenManager();
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 0.5, easing: 'linear' });

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { wait: 0.5 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.play();

      // Tick step 1 done
      tween1.tick(0.5);
      // Now the wait step is active in the pool
      // Tick the pool to advance the wait slot
      manager['_pool'].tick(0.5);
      // After the wait, tween2 should have started
      expect(tween2.playing).toBe(true);
    });
  });
});

// ── onComplete fires once at sequence end ─────────────────────────────────────

describe('defineSequence() onComplete', () => {
  it('fires once when all steps complete', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const cb = vi.fn();

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.onComplete(cb);
      seq.play();

      tween1.tick(0.5); // step 1 done
      tween2.tick(0.5); // step 2 done

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire before all steps complete', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const cb = vi.fn();

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.onComplete(cb);
      seq.play();

      tween1.tick(0.5); // only step 1 done
      expect(cb).toHaveBeenCalledTimes(0);
    });
  });

  it('multiple onComplete callbacks all fire', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 0.5 });
      const cb1 = vi.fn();
      const cb2 = vi.fn();

      const seq = defineSequence([{ tween, from: 0, to: 1 }]);

      seq.onComplete(cb1);
      seq.onComplete(cb2);
      seq.play();
      tween.tick(0.5);

      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });
});

// ── empty steps array ─────────────────────────────────────────────────────────

describe('defineSequence() with empty steps array', () => {
  it('onComplete fires immediately when play() is called with empty steps', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const cb = vi.fn();
      const seq = defineSequence([]);
      seq.onComplete(cb);
      seq.play();
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});

// ── pause() ───────────────────────────────────────────────────────────────────

describe('defineSequence() pause()', () => {
  it('pause() during a tween step stops the tween', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      const seq = defineSequence([{ tween, from: 0, to: 100 }]);

      seq.play();
      tween.tick(0.25); // 25%
      seq.pause();
      // Tween should be paused
      expect(tween.playing).toBe(false);
    });
  });

  it('pause() during a wait step pauses the wait slot', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const manager = getTweenManager();
      const tween1 = useTween<number>({ duration: 0.1 });
      const tween2 = useTween<number>({ duration: 0.5 });
      const cb = vi.fn();

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { wait: 1.0 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.onComplete(cb);
      seq.play();

      // Finish step 1
      tween1.tick(0.1);
      // Now in wait step — pause the sequence
      seq.pause();

      // Tick pool — wait slot should not advance past 1s because it's paused
      manager['_pool'].tick(1.5);

      // tween2 should not have started
      expect(tween2.playing).toBe(false);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});

// ── reset() ───────────────────────────────────────────────────────────────────

describe('defineSequence() reset()', () => {
  it('reset() stops execution', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      const cb = vi.fn();
      const seq = defineSequence([{ tween, from: 0, to: 1 }]);

      seq.onComplete(cb);
      seq.play();
      tween.tick(0.25);
      seq.reset();

      // Tween should be reset
      expect(tween.playing).toBe(false);
      // onComplete should not have fired
      expect(cb).not.toHaveBeenCalled();
    });
  });

  it('play() after reset() restarts from beginning', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween1 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const tween2 = useTween<number>({ duration: 0.5, easing: 'linear' });
      const order: string[] = [];

      const seq = defineSequence([
        { tween: tween1, from: 0, to: 1 },
        { tween: tween2, from: 0, to: 1 },
      ]);

      seq.play();
      tween1.tick(0.25); // partway through step 1
      seq.reset();

      // Now restart
      seq.play();

      // seq.play() calls _runStep(0) → tween1.play() (clears cbs).
      // Register AFTER seq.play() to avoid being wiped.
      tween1.onComplete(() => order.push('step1'));

      tween1.tick(0.5); // complete step 1 again
      // tween2 is now started; register its callback
      tween2.onComplete(() => order.push('step2'));
      tween2.tick(0.5); // complete step 2

      expect(order).toEqual(['step1', 'step2']);
    });
  });

  it('reset() releases active wait slot back to pool', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const manager = getTweenManager();
      const pool = manager['_pool'];
      const tween1 = useTween<number>({ duration: 0.1 });

      const seq = defineSequence([{ tween: tween1, from: 0, to: 1 }, { wait: 1.0 }]);

      seq.play();
      tween1.tick(0.1); // advance to wait step
      const activeAfterWaitStart = pool.activeCount;

      seq.reset(); // should release the wait slot
      const activeAfterReset = pool.activeCount;

      // After reset, the wait slot should be released
      expect(activeAfterReset).toBe(activeAfterWaitStart - 1);
    });
  });
});

// ── defineSequence() called outside context ───────────────────────────────────

describe('defineSequence() outside engine context', () => {
  it('throws when called outside any engine context', () => {
    expect(() => defineSequence([])).toThrow();
  });
});
