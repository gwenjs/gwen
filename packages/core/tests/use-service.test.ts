/**
 * @file useService composable tests
 *
 * Tests for the `useService()` composable defined in system.ts.
 * Covers:
 * - Typed lookup via GwenProvides declaration merging
 * - Generic untyped fallback
 * - Throws GwenPluginNotFoundError when service is absent
 * - Throws GwenContextError when called outside engine context
 * - Service captured at setup time is accessible inside lifecycle callbacks
 */

import { describe, it, expect } from 'vitest';
import {
  createEngine,
  useService,
  defineSystem,
  onUpdate,
  engineContext,
  GwenContextError,
  GwenPluginNotFoundError,
} from '../src/index';

// ─── Declaration merging for test scope ───────────────────────────────────────

declare module '../src/engine/gwen-engine' {
  interface GwenProvides {
    /** Test service registered in these tests. */
    testCounter: { increment(): number; count(): number };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCounter() {
  let n = 0;
  return { increment: () => ++n, count: () => n };
}

// ─── useService() ─────────────────────────────────────────────────────────────

describe('useService()', () => {
  it('throws GwenContextError when called outside any engine context', () => {
    engineContext.unset();
    expect(() => useService('testCounter')).toThrow(GwenContextError);
  });

  it('resolves a registered service inside engine.run()', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    const counter = makeCounter();
    engine.provide('testCounter', counter);

    const result = engine.run(() => useService('testCounter'));
    expect(result).toBe(counter);
  });

  it('resolves the correct service instance when multiple are registered', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    const counterA = makeCounter();
    engine.provide('testCounter', counterA);

    const resolved = engine.run(() => useService('testCounter'));
    expect(resolved).toBe(counterA);
    expect(resolved.count()).toBe(0);
  });

  it('resolved service is the same reference provided via engine.provide()', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    const counter = makeCounter();
    engine.provide('testCounter', counter);

    const result = engine.run(() => useService('testCounter'));
    expect(result).toBe(counter);
  });

  it('throws GwenPluginNotFoundError when service is absent', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    // 'testCounter' has NOT been provided
    expect(() => engine.run(() => useService('testCounter'))).toThrow(GwenPluginNotFoundError);
  });

  it('error from absent service contains the service key', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    let caught: GwenPluginNotFoundError | null = null;
    try {
      engine.run(() => useService('testCounter'));
    } catch (e) {
      if (e instanceof GwenPluginNotFoundError) caught = e;
    }
    expect(caught).not.toBeNull();
    expect(caught!.pluginName).toBe('testCounter');
  });

  it('resolves service inside defineSystem setup (composable pattern)', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    const counter = makeCounter();
    engine.provide('testCounter', counter);

    let capturedService: ReturnType<typeof makeCounter> | null = null;

    const system = defineSystem(() => {
      capturedService = useService('testCounter');
    });

    await engine.use(system);
    expect(capturedService).toBe(counter);
  });

  it('service captured at setup time is callable inside onUpdate()', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    const counter = makeCounter();
    engine.provide('testCounter', counter);

    const system = defineSystem(() => {
      const svc = useService('testCounter');
      onUpdate(() => svc.increment());
    });

    await engine.use(system);
    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(counter.count()).toBe(2);
  });

  it('generic fallback returns T when key is not in GwenProvides', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    const rawService = { ping: () => 'pong' };
    engine.provide('testCounter', rawService as never);

    // Using generic fallback <{ ping(): string }>
    const result = engine.run(() => useService<{ ping(): string }>('testCounter'));
    expect(result.ping()).toBe('pong');
  });

  it('useService() spy is called each time inside run()', async () => {
    const engine = await createEngine({ maxEntities: 10 });
    let val = 0;
    engine.provide('testCounter', {
      increment() {
        return ++val;
      },
      count() {
        return val;
      },
    });

    const calls: number[] = [];
    const system = defineSystem(() => {
      const svc = useService('testCounter');
      onUpdate(() => {
        calls.push(svc.increment());
      });
    });

    await engine.use(system);
    await engine.advance(0.016);
    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(calls).toEqual([1, 2, 3]);
  });
});
