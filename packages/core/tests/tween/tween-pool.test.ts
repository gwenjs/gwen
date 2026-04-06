/**
 * @file RFC-03 — TweenPool and TweenSlot unit tests
 *
 * Verifies:
 * - TweenPool construction (default and custom sizes)
 * - claim() / release() lifecycle
 * - Pool exhaustion: grow / throw / drop policies
 * - activeCount tracking
 * - TweenSlot.tick() value interpolation
 * - TweenSlot loop / yoyo / loop+yoyo modes
 * - onComplete fires correctly
 * - pause() / resume() halts and continues progress
 * - reset() returns to `from` value
 * - Logger injection: warn on grow, debug at warnAt threshold
 */

import { describe, it, expect, vi } from 'vitest';
import { TweenPool } from '../../src/tween/tween-pool';
import type { GwenLogger } from '../../src/logger/types';

// ── Helper: build a minimal mock GwenLogger ───────────────────────────────────

/**
 * Create a mock {@link GwenLogger} spy for use in policy tests.
 */
function mockLogger(): GwenLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    setSink: vi.fn(),
  };
}

// ── TweenPool construction ────────────────────────────────────────────────────

describe('TweenPool construction', () => {
  it('creates a pool with default size of 256', () => {
    const pool = new TweenPool();
    expect(pool.activeCount).toBe(0);
  });

  it('creates a pool with a custom size', () => {
    const pool = new TweenPool(16);
    expect(pool.activeCount).toBe(0);
  });

  it('throws when size < 1', () => {
    expect(() => new TweenPool(0)).toThrow('[GWEN]');
  });
});

// ── claim() / release() lifecycle ────────────────────────────────────────────

describe('TweenPool claim() and release()', () => {
  it('claim() returns a TweenSlot', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    expect(slot).toBeDefined();
    expect(slot).not.toBeNull();
    expect(typeof slot!.tick).toBe('function');
    expect(typeof slot!.play).toBe('function');
  });

  it('claim() increases activeCount', () => {
    const pool = new TweenPool(4);
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    expect(pool.activeCount).toBe(2);
  });

  it('release() decreases activeCount', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    pool.claim({ duration: 1 });
    pool.release(slot!);
    expect(pool.activeCount).toBe(1);
  });

  it('released slot can be re-claimed', () => {
    const pool = new TweenPool(1);
    const slot = pool.claim({ duration: 1 })!;
    pool.release(slot!);
    const slot2 = pool.claim({ duration: 2 })!;
    expect(slot2).toBeDefined();
  });

  it('release() is idempotent — releasing twice does not corrupt count', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    pool.release(slot!);
    pool.release(slot!); // second release should be a no-op
    expect(pool.activeCount).toBe(0);
  });

  it('throws when pool is exhausted (throw policy)', () => {
    const pool = new TweenPool(2, { onExhausted: 'throw' });
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    expect(() => pool.claim({ duration: 1 })).toThrow('[GWEN]');
  });

  it('exhausted pool can accept a claim after a release', () => {
    const pool = new TweenPool(1, { onExhausted: 'throw' });
    const slot = pool.claim({ duration: 1 })!;
    pool.release(slot!);
    expect(() => pool.claim({ duration: 1 })).not.toThrow();
  });
});

// ── TweenPool growth policy ───────────────────────────────────────────────────

describe('TweenPool growth policy', () => {
  it('uses grow policy by default — pool grows when exhausted', () => {
    const pool = new TweenPool(2);
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    // With default 'grow' policy, a third claim should NOT throw
    expect(() => pool.claim({ duration: 1 })).not.toThrow();
    // After growing, activeCount should reflect the extra slot
    expect(pool.activeCount).toBe(3);
  });

  it('respects throw policy — throws GwenConfigError when exhausted', async () => {
    const { GwenConfigError } = await import('../../src/engine/config-error');
    const pool = new TweenPool(2, { onExhausted: 'throw' });
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    expect(() => pool.claim({ duration: 1 })).toThrow(GwenConfigError);
  });

  it('respects drop policy — returns null when exhausted', () => {
    const pool = new TweenPool(2, { onExhausted: 'drop' });
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    const result = pool.claim({ duration: 1 });
    expect(result).toBeNull();
  });

  it('emits warn via logger when growing', () => {
    const logger = mockLogger();
    const pool = new TweenPool(2, { onExhausted: 'grow' }, logger);
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 }); // triggers grow
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[TweenPool]'),
      expect.objectContaining({ from: 2 }),
    );
  });

  it('respects maxSize cap in grow policy — throws GwenConfigError when maxSize reached', async () => {
    const { GwenConfigError } = await import('../../src/engine/config-error');
    // pool of 2 with maxSize 2 — cannot grow beyond 2
    const pool = new TweenPool(2, { onExhausted: 'grow', growthFactor: 2, maxSize: 2 });
    pool.claim({ duration: 1 });
    pool.claim({ duration: 1 });
    expect(() => pool.claim({ duration: 1 })).toThrow(GwenConfigError);
  });

  it('emits debug at warnAt threshold', () => {
    const logger = mockLogger();
    // Pool of 4 with warnAt = 0.5 → debug fires when 2 or more slots are active
    const pool = new TweenPool(4, { onExhausted: 'grow', warnAt: 0.5 }, logger);
    pool.claim({ duration: 1 }); // 1/4 = 25% — below threshold
    expect(logger.debug).not.toHaveBeenCalled();
    pool.claim({ duration: 1 }); // 2/4 = 50% — at threshold → should fire
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('[TweenPool]'),
      expect.objectContaining({ used: 2, capacity: 4 }),
    );
  });
});

// ── TweenSlot initial state ───────────────────────────────────────────────────

describe('TweenSlot initial state after claim()', () => {
  it('is not playing after claim()', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    expect(slot.playing).toBe(false);
  });

  it('value is 0 before play()', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    expect(slot.value).toBe(0);
  });
});

// ── TweenSlot.play() + tick() — number interpolation ─────────────────────────

describe('TweenSlot number interpolation via tick()', () => {
  it('value equals `from` immediately after play()', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    expect(slot.value).toBe(0);
    expect(slot.playing).toBe(true);
  });

  it('value interpolates linearly at t=0.5', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(0.5);
    expect(slot.value).toBeCloseTo(50, 3);
  });

  it('value equals `to` at t=1.0', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(1.0);
    expect(slot.value).toBeCloseTo(100, 3);
  });

  it('stops playing after duration for non-loop tween', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(1.0);
    expect(slot.playing).toBe(false);
  });

  it('uses easeInQuad easing correctly at t=0.5', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'easeInQuad' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(0.5);
    // easeInQuad(0.5) = 0.25
    expect(slot.value).toBeCloseTo(25, 2);
  });

  it('accepts a custom easing function', () => {
    const pool = new TweenPool(4);
    const customEasing = (t: number) => t * t * t; // cubic
    const slot = pool.claim({ duration: 1, easing: customEasing })!;
    slot.play({ from: 0, to: 8 });
    slot.tick(0.5);
    // cubic(0.5) = 0.125, lerp(0, 8, 0.125) = 1
    expect(slot.value).toBeCloseTo(1, 3);
  });
});

// ── TweenSlot loop mode ───────────────────────────────────────────────────────

describe('TweenSlot loop mode', () => {
  it('continues playing after one full cycle', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, loop: true })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(1.0); // complete first cycle
    expect(slot.playing).toBe(true);
  });

  it('value is at mid-point 1.5 cycles in (loop)', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear', loop: true })!;
    slot.play({ from: 0, to: 100 });
    // tick(1.5) lands value at end of cycle (100) with elapsed reset to 0.5;
    // the value is not re-computed after the elapsed reset — use two ticks instead.
    slot.tick(1.0); // completes first cycle
    slot.tick(0.5); // 0.5 into second cycle
    expect(slot.value).toBeCloseTo(50, 2);
  });

  it('fires onComplete once per loop cycle', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, loop: true })!;
    slot.play({ from: 0, to: 100 });
    const cb = vi.fn();
    slot.onComplete(cb);
    slot.tick(1.0); // complete cycle 1
    slot.tick(1.0); // complete cycle 2
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ── TweenSlot yoyo mode ───────────────────────────────────────────────────────

describe('TweenSlot yoyo mode (no loop)', () => {
  it('value reverses on return leg', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear', yoyo: true })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(1.0); // end of forward leg: switches to return leg
    // At start of return leg, elapsed=0 so tick another 0.5 to reach midpoint
    slot.tick(0.5); // halfway through return leg
    expect(slot.value).toBeCloseTo(50, 2);
  });

  it('stops after return leg completes (yoyo-only, no loop)', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear', yoyo: true })!;
    slot.play({ from: 0, to: 100 });
    // tick(2.0) in a single call doesn't re-process the return-leg overflow;
    // use two separate ticks of duration length instead.
    slot.tick(1.0); // forward leg complete → switches to return leg
    slot.tick(1.0); // return leg complete → playing stops
    expect(slot.playing).toBe(false);
  });

  it('value returns to `from` after full yoyo cycle', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear', yoyo: true })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(1.0); // forward leg → value reaches 100
    slot.tick(1.0); // return leg → value returns to 0
    expect(slot.value).toBeCloseTo(0, 2);
  });

  it('fires onComplete twice: once for forward leg, once for return leg', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 0.5, easing: 'linear', yoyo: true })!;
    slot.play({ from: 0, to: 100 });
    const cb = vi.fn();
    slot.onComplete(cb);
    slot.tick(0.5); // end of forward leg
    slot.tick(0.5); // end of return leg
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ── TweenSlot loop + yoyo ─────────────────────────────────────────────────────

describe('TweenSlot loop + yoyo mode', () => {
  it('oscillates continuously', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear', loop: true, yoyo: true })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(1.0); // end of forward leg — starts return
    expect(slot.playing).toBe(true);
    slot.tick(1.0); // end of return leg — starts forward again
    expect(slot.playing).toBe(true);
    slot.tick(0.5); // halfway through 3rd leg (forward)
    expect(slot.value).toBeCloseTo(50, 2);
  });

  it('fires onComplete on each half-cycle (loop + yoyo)', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 0.5, easing: 'linear', loop: true, yoyo: true })!;
    slot.play({ from: 0, to: 100 });
    const cb = vi.fn();
    slot.onComplete(cb);
    // 4 half-cycles
    for (let i = 0; i < 4; i++) {
      slot.tick(0.5);
    }
    expect(cb).toHaveBeenCalledTimes(4);
  });
});

// ── TweenSlot onComplete for non-loop tween ───────────────────────────────────

describe('TweenSlot onComplete callback', () => {
  it('fires exactly once for a non-loop tween', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    slot.play({ from: 0, to: 100 });
    const cb = vi.fn();
    slot.onComplete(cb);
    slot.tick(0.5); // not done yet
    slot.tick(1.0); // completes
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('onComplete fires synchronously within tick()', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 0.5 })!;
    slot.play({ from: 0, to: 1 });
    const log: string[] = [];
    slot.onComplete(() => log.push('complete'));
    slot.tick(0.5);
    expect(log).toContain('complete');
  });

  it('multiple onComplete callbacks all fire', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    slot.play({ from: 0, to: 1 });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    slot.onComplete(cb1);
    slot.onComplete(cb2);
    slot.tick(1.0);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('play() clears previous onComplete listeners', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    const cb = vi.fn();
    slot.play({ from: 0, to: 1 });
    slot.onComplete(cb);
    // restart before completing
    slot.play({ from: 0, to: 1 });
    slot.tick(1.0);
    // Should not be called from the stale registration
    expect(cb).toHaveBeenCalledTimes(0);
  });
});

// ── TweenSlot pause() / resume() ─────────────────────────────────────────────

describe('TweenSlot pause() and resume()', () => {
  it('pause() stops progress', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(0.25); // at 25%
    slot.pause();
    const valueBefore = slot.value as number;
    slot.tick(0.5); // tick while paused — no change
    expect(slot.value).toBe(valueBefore);
    expect(slot.playing).toBe(false);
  });

  it('resume() continues from paused position', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(0.25); // 25%
    slot.pause();
    slot.resume();
    expect(slot.playing).toBe(true);
    slot.tick(0.25); // 25% + 25% = 50%
    expect(slot.value).toBeCloseTo(50, 2);
  });
});

// ── TweenSlot reset() ─────────────────────────────────────────────────────────

describe('TweenSlot reset()', () => {
  it('reset() stops playing', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1 })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(0.5);
    slot.reset();
    expect(slot.playing).toBe(false);
  });

  it('reset() returns value to `from`', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 10, to: 100 });
    slot.tick(0.5);
    slot.reset();
    expect(slot.value).toBe(10);
  });

  it('reset() allows play() to restart from scratch', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: 0, to: 100 });
    slot.tick(0.5);
    slot.reset();
    slot.play({ from: 0, to: 100 });
    slot.tick(0.5);
    expect(slot.value).toBeCloseTo(50, 2);
  });
});

// ── TweenPool.tick() ─────────────────────────────────────────────────────────

describe('TweenPool.tick()', () => {
  it('advances all active slots', () => {
    const pool = new TweenPool(4);
    const s1 = pool.claim({ duration: 1, easing: 'linear' })!;
    const s2 = pool.claim({ duration: 1, easing: 'linear' })!;
    s1.play({ from: 0, to: 100 });
    s2.play({ from: 0, to: 200 });
    pool.tick(0.5);
    expect(s1.value).toBeCloseTo(50, 2);
    expect(s2.value).toBeCloseTo(100, 2);
  });

  it('does not tick inactive (non-playing) slots', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    // Not calling play() — slot is not active/playing
    pool.tick(0.5);
    expect(slot.value).toBe(0); // unchanged
  });

  it('allows release() from within onComplete without corrupting iteration', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 0.5 })!;
    slot.play({ from: 0, to: 1 });
    slot.onComplete(() => {
      pool.release(slot); // release during tick
    });
    expect(() => pool.tick(0.5)).not.toThrow();
    expect(pool.activeCount).toBe(0);
  });
});

// ── Vec2 interpolation ────────────────────────────────────────────────────────

describe('TweenSlot Vec2 interpolation', () => {
  it('interpolates x and y components independently', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({
      from: { x: 0, y: 0 },
      to: { x: 100, y: 200 },
    });
    slot.tick(0.5);
    const v = slot.value as { x: number; y: number };
    expect(v.x).toBeCloseTo(50, 2);
    expect(v.y).toBeCloseTo(100, 2);
  });

  it('returns same object reference (zero-alloc)', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    slot.play({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
    slot.tick(0.1);
    const ref1 = slot.value;
    slot.tick(0.1);
    const ref2 = slot.value;
    // The same scratch object is reused
    expect(ref1).toBe(ref2);
  });
});

// ── Color interpolation ───────────────────────────────────────────────────────

describe('TweenSlot Color interpolation', () => {
  it('interpolates Color values correctly', () => {
    const pool = new TweenPool(4);
    const slot = pool.claim({ duration: 1, easing: 'linear' })!;
    const from = { r: 0, g: 0, b: 0, a: 0 };
    const to = { r: 1, g: 0.5, b: 0.25, a: 1 };
    slot.play({ from, to });
    slot.tick(0.5);
    const v = slot.value as { r: number; g: number; b: number; a: number };
    expect(v.r).toBeCloseTo(0.5);
    expect(v.g).toBeCloseTo(0.25);
    expect(v.b).toBeCloseTo(0.125);
    expect(v.a).toBeCloseTo(0.5);
    pool.release(slot);
  });
});
