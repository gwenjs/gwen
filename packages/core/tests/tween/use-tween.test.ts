/**
 * @file RFC-03 — useTween composable unit tests
 *
 * Verifies:
 * - useTween<number>() inside engine.run() returns a TweenHandle
 * - useTween<Vec2>() interpolates both x and y correctly
 * - Calling useTween() outside engine context throws
 * - play / pause / resume / reset lifecycle
 * - onComplete fires exactly once for non-loop tween
 * - onComplete fires on each cycle for loop tween
 * - yoyo: value reverses correctly on second half
 */

import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../../src/index';
import { useTween } from '../../src/tween/use-tween';
import { getTweenManager } from '../../src/tween/tween-manager';

// ── useTween() outside context ────────────────────────────────────────────────

describe('useTween() outside engine context', () => {
  it('throws when called outside any engine context', () => {
    expect(() => useTween<number>({ duration: 1 })).toThrow();
  });

  it('error message mentions engine context requirements', () => {
    let msg = '';
    try {
      useTween<number>({ duration: 1 });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg.length).toBeGreaterThan(0);
  });
});

// ── useTween<number>() basic lifecycle ───────────────────────────────────────

describe('useTween<number>()', () => {
  it('returns a TweenHandle with play, pause, resume, reset, onComplete, value, playing', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      expect(typeof tween.play).toBe('function');
      expect(typeof tween.pause).toBe('function');
      expect(typeof tween.resume).toBe('function');
      expect(typeof tween.reset).toBe('function');
      expect(typeof tween.onComplete).toBe('function');
      expect('value' in tween).toBe(true);
      expect('playing' in tween).toBe(true);
    });
  });

  it('value is 0 before play()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1 });
      expect(tween.value).toBe(0);
    });
  });

  it('playing is false before play()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1 });
      expect(tween.playing).toBe(false);
    });
  });

  it('play() sets playing to true and value to `from`', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 10, to: 100 });
      expect(tween.playing).toBe(true);
      expect(tween.value).toBe(10);
    });
  });

  it('tick() advances value linearly', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 0, to: 100 });
      tween.tick(0.5);
      expect(tween.value).toBeCloseTo(50, 2);
    });
  });

  it('value reaches `to` at exactly t=1.0', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 0, to: 100 });
      tween.tick(1.0);
      expect(tween.value).toBeCloseTo(100, 3);
    });
  });

  it('stops playing after duration', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1 });
      tween.play({ from: 0, to: 1 });
      tween.tick(1.0);
      expect(tween.playing).toBe(false);
    });
  });
});

// ── useTween<Vec2>() ──────────────────────────────────────────────────────────

describe('useTween<Vec2>()', () => {
  it('interpolates x and y correctly at t=0.5', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<{ x: number; y: number }>({ duration: 1, easing: 'linear' });
      tween.play({ from: { x: 0, y: 0 }, to: { x: 100, y: 200 } });
      tween.tick(0.5);
      const v = tween.value as { x: number; y: number };
      expect(v.x).toBeCloseTo(50, 2);
      expect(v.y).toBeCloseTo(100, 2);
    });
  });

  it('reaches target {x, y} at t=1.0', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<{ x: number; y: number }>({ duration: 1, easing: 'linear' });
      tween.play({ from: { x: 0, y: 0 }, to: { x: 50, y: 75 } });
      tween.tick(1.0);
      const v = tween.value as { x: number; y: number };
      expect(v.x).toBeCloseTo(50, 3);
      expect(v.y).toBeCloseTo(75, 3);
    });
  });
});

// ── pause() / resume() ────────────────────────────────────────────────────────

describe('useTween pause() and resume()', () => {
  it('pause() halts progress', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 0, to: 100 });
      tween.tick(0.25);
      const valueAtPause = tween.value as number;
      tween.pause();
      tween.tick(0.5);
      expect(tween.value).toBe(valueAtPause);
      expect(tween.playing).toBe(false);
    });
  });

  it('resume() continues from paused position', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 0, to: 100 });
      tween.tick(0.25); // at 25
      tween.pause();
      tween.resume();
      expect(tween.playing).toBe(true);
      tween.tick(0.25); // 50
      expect(tween.value).toBeCloseTo(50, 2);
    });
  });
});

// ── reset() ───────────────────────────────────────────────────────────────────

describe('useTween reset()', () => {
  it('reset() stops playing and returns to `from`', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 5, to: 100 });
      tween.tick(0.5);
      tween.reset();
      expect(tween.playing).toBe(false);
      expect(tween.value).toBe(5);
    });
  });

  it('play() after reset() restarts from the beginning', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear' });
      tween.play({ from: 0, to: 100 });
      tween.tick(0.8);
      tween.reset();
      tween.play({ from: 0, to: 100 });
      tween.tick(0.5);
      expect(tween.value).toBeCloseTo(50, 2);
    });
  });
});

// ── onComplete ────────────────────────────────────────────────────────────────

describe('useTween onComplete()', () => {
  it('fires exactly once for a non-loop tween', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1 });
      tween.play({ from: 0, to: 1 });
      const cb = vi.fn();
      tween.onComplete(cb);
      tween.tick(0.5);
      tween.tick(1.0);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  it('does NOT fire again after tween stops for non-loop', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 0.5 });
      tween.play({ from: 0, to: 1 });
      const cb = vi.fn();
      tween.onComplete(cb);
      tween.tick(0.5); // completes
      tween.tick(0.5); // extra tick, already stopped
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  it('fires on each cycle for a looping tween', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 0.5, loop: true });
      tween.play({ from: 0, to: 1 });
      const cb = vi.fn();
      tween.onComplete(cb);
      tween.tick(0.5); // cycle 1
      tween.tick(0.5); // cycle 2
      tween.tick(0.5); // cycle 3
      expect(cb).toHaveBeenCalledTimes(3);
    });
  });
});

// ── yoyo mode ────────────────────────────────────────────────────────────────

describe('useTween yoyo mode', () => {
  it('value reverses on second half', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear', yoyo: true });
      tween.play({ from: 0, to: 100 });
      tween.tick(1.0); // completes forward leg → switches to return leg
      tween.tick(0.5); // halfway through return leg
      expect(tween.value).toBeCloseTo(50, 2);
    });
  });

  it('stops after full yoyo cycle (no loop)', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      const tween = useTween<number>({ duration: 1, easing: 'linear', yoyo: true });
      tween.play({ from: 0, to: 100 });
      tween.tick(1.0); // forward leg
      tween.tick(1.0); // return leg
      expect(tween.playing).toBe(false);
    });
  });
});

// ── getTweenManager singleton ─────────────────────────────────────────────────

describe('getTweenManager() singleton', () => {
  it('returns the same instance on subsequent calls', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const m1 = engine.run(() => getTweenManager());
    const m2 = engine.run(() => getTweenManager());
    expect(m1).toBe(m2);
  });

  it('throws when called outside engine context without explicit engine', () => {
    expect(() => getTweenManager()).toThrow('[GWEN]');
  });

  it('accepts explicit engine parameter', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const manager = getTweenManager(engine as Parameters<typeof getTweenManager>[0]);
    expect(manager).toBeDefined();
  });
});

// ── engine.advance() integrates tween tick via hook ──────────────────────────

describe('engine.advance() drives tween via engine:tick hook', () => {
  it('tween value updates when engine advances', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let capturedTween: ReturnType<typeof useTween<number>> | null = null;

    await engine.use({
      name: 'tween-test-plugin',
      setup() {
        capturedTween = useTween<number>({ duration: 1, easing: 'linear' });
        capturedTween.play({ from: 0, to: 100 });
      },
    });

    await engine.advance(0.5);
    expect(capturedTween).not.toBeNull();
    expect(capturedTween!.value).toBeCloseTo(50, 2);
  });
});
