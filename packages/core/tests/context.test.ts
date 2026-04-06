/**
 * @file RFC-005 — Context system tests
 *
 * Tests for:
 * - `useEngine()` composable
 * - `engine.run()` context scoping
 * - `engine.activate()` / `engine.deactivate()` manual lifecycle
 * - Frame loop context (via `engine.advance()`)
 * - Plugin setup context
 * - Multi-instance isolation
 * - `GwenContextError` and `GwenPluginNotFoundError`
 * - `defineSystem()` composable pattern
 * - `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`
 * - Performance: 10k `useEngine()` calls < 0.5ms
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createEngine,
  useEngine,
  GwenContextError,
  GwenPluginNotFoundError,
  defineSystem,
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
  useQuery,
  engineContext,
} from '../src/index';

// ─── useEngine() ─────────────────────────────────────────────────────────────

describe('useEngine()', () => {
  it('throws GwenContextError when called outside any engine context', () => {
    // Ensure context is clear before test
    engineContext.unset();
    expect(() => useEngine()).toThrow(GwenContextError);
  });

  it('error message mentions defineSystem, engine.run, and lifecycle hooks', () => {
    engineContext.unset();
    let msg = '';
    try {
      useEngine();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('defineSystem');
    expect(msg).toContain('engine.run');
  });

  it('returns the engine instance inside engine.run()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const result = engine.run(() => useEngine());
    expect(result).toBe(engine);
  });

  it('returns engine inside plugin setup()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let captured: unknown;
    await engine.use({
      name: 'test-setup-context',
      setup() {
        captured = useEngine();
      },
    });
    expect(captured).toBe(engine);
  });

  it('returns engine inside plugin onUpdate() (frame context)', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let captured: unknown;
    await engine.use({
      name: 'test-update-context',
      setup() {},
      onUpdate() {
        captured = useEngine();
      },
    });
    await engine.advance(0.016);
    expect(captured).toBe(engine);
  });

  it('returns engine inside plugin onBeforeUpdate()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let captured: unknown;
    await engine.use({
      name: 'test-before-update-context',
      setup() {},
      onBeforeUpdate() {
        captured = useEngine();
      },
    });
    await engine.advance(0.016);
    expect(captured).toBe(engine);
  });

  it('returns engine inside plugin onAfterUpdate()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let captured: unknown;
    await engine.use({
      name: 'test-after-update-context',
      setup() {},
      onAfterUpdate() {
        captured = useEngine();
      },
    });
    await engine.advance(0.016);
    expect(captured).toBe(engine);
  });

  it('returns engine inside plugin onRender()', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let captured: unknown;
    await engine.use({
      name: 'test-render-context',
      setup() {},
      onRender() {
        captured = useEngine();
      },
    });
    await engine.advance(0.016);
    expect(captured).toBe(engine);
  });
});

// ─── engine.run() ─────────────────────────────────────────────────────────────

describe('engine.run()', () => {
  it('returns the fn return value', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const result = engine.run(() => 42);
    expect(result).toBe(42);
  });

  it('restores previous context after sequential calls', async () => {
    const engine1 = await createEngine({ maxEntities: 100 });
    const engine2 = await createEngine({ maxEntities: 100 });

    // Sequential runs work fine — context is set and restored each time
    const r1 = engine1.run(() => useEngine());
    const r2 = engine2.run(() => useEngine());

    expect(r1).toBe(engine1);
    expect(r2).toBe(engine2);
  });

  it('clears context after the call (no context leak)', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.run(() => {
      // inside — context is set
      expect(useEngine()).toBe(engine);
    });
    // outside — context should be cleared
    expect(() => useEngine()).toThrow(GwenContextError);
  });
});

// ─── engine.activate() / engine.deactivate() ──────────────────────────────────

describe('engine.activate() / engine.deactivate()', () => {
  beforeEach(() => {
    engineContext.unset();
  });

  it('activate() makes useEngine() return the engine', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.activate();
    try {
      expect(useEngine()).toBe(engine);
    } finally {
      engine.deactivate();
    }
  });

  it('deactivate() clears the context', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    engine.activate();
    engine.deactivate();
    expect(() => useEngine()).toThrow(GwenContextError);
  });
});

// ─── Multi-instance isolation ──────────────────────────────────────────────────

describe('Multi-instance isolation', () => {
  it('engine.run() isolates context per instance', async () => {
    const engine1 = await createEngine({ maxEntities: 100 });
    const engine2 = await createEngine({ maxEntities: 100 });

    const result1 = engine1.run(() => useEngine());
    const result2 = engine2.run(() => useEngine());

    expect(result1).toBe(engine1);
    expect(result2).toBe(engine2);
    expect(result1).not.toBe(result2);
  });

  it('two engines do not interfere in sequential runs', async () => {
    const engine1 = await createEngine({ maxEntities: 100 });
    const engine2 = await createEngine({ maxEntities: 100 });
    const results: unknown[] = [];

    engine1.run(() => results.push(useEngine()));
    engine2.run(() => results.push(useEngine()));

    expect(results[0]).toBe(engine1);
    expect(results[1]).toBe(engine2);
  });
});

// ─── GwenContextError ─────────────────────────────────────────────────────────

describe('GwenContextError', () => {
  it('is an instance of Error', () => {
    const err = new GwenContextError('test message');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GwenContextError);
  });

  it('has name GwenContextError', () => {
    const err = new GwenContextError('test');
    expect(err.name).toBe('GwenContextError');
  });

  it('useEngine() throws GwenContextError (not generic Error)', () => {
    engineContext.unset();
    let caught: unknown;
    try {
      useEngine();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GwenContextError);
  });
});

// ─── GwenPluginNotFoundError ───────────────────────────────────────────────────

describe('GwenPluginNotFoundError', () => {
  it('supports options-object constructor (RFC-005 form)', () => {
    const err = new GwenPluginNotFoundError({
      pluginName: '@gwenjs/physics2d',
      hint: 'Add @gwenjs/physics2d to the modules array in gwen.config.ts',
      docsUrl: 'https://gwenengine.dev/modules/physics2d',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GwenPluginNotFoundError);
    expect(err.pluginName).toBe('@gwenjs/physics2d');
    expect(err.hint).toContain('gwen.config.ts');
    expect(err.docsUrl).toMatch(/^https?:\/\//);
  });

  it('supports positional constructor (legacy form)', () => {
    const err = new GwenPluginNotFoundError({
      pluginName: 'math',
      hint: '',
      docsUrl: '',
    });
    expect(err.pluginName).toBe('math');
    expect(err.hint.length).toBeGreaterThan(0);
    expect(err.docsUrl).toMatch(/^https?:\/\//);
  });

  it('message contains the plugin name', () => {
    const err = new GwenPluginNotFoundError({
      pluginName: '@gwenjs/physics2d',
      hint: 'hint text',
      docsUrl: 'https://example.com',
    });
    expect(err.message).toContain('@gwenjs/physics2d');
  });

  it('has name GwenPluginNotFoundError', () => {
    const err = new GwenPluginNotFoundError({
      pluginName: 'test',
      hint: 'test hint',
      docsUrl: 'https://example.com',
    });
    expect(err.name).toBe('GwenPluginNotFoundError');
  });

  it('engine.inject() throws GwenPluginNotFoundError when service is absent', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    expect(() => engine.inject('testSvc' as never)).toThrow(GwenPluginNotFoundError);
  });

  it('thrown error from inject() can be caught as GwenPluginNotFoundError', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let caughtErr: GwenPluginNotFoundError | null = null;
    try {
      engine.inject('testSvc' as never);
    } catch (e) {
      if (e instanceof GwenPluginNotFoundError) caughtErr = e;
    }
    expect(caughtErr).not.toBeNull();
    expect(caughtErr!.pluginName).toBe('testSvc');
    expect(caughtErr!.hint.length).toBeGreaterThan(0);
    expect(caughtErr!.docsUrl).toMatch(/^https?:\/\//);
  });
});

// ─── defineSystem() composable pattern ────────────────────────────────────────

describe('defineSystem()', () => {
  it('returns a GwenPlugin with a name', () => {
    const system = defineSystem(function mySystem() {});
    expect(system.name).toBe('mySystem');
    expect(typeof system.setup).toBe('function');
  });

  it('anonymous setup fn gets name "anonymous-system"', () => {
    const system = defineSystem(() => {});
    expect(system.name).toBe('anonymous-system');
  });

  it('onUpdate callback is called every frame with dt', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const spy = vi.fn();
    const system = defineSystem(() => {
      onUpdate(spy);
    });
    await engine.use(system);
    await engine.advance(0.016);
    await engine.advance(0.016);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(0.016);
  });

  it('onBeforeUpdate callback is called before update phase', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const order: string[] = [];
    await engine.use({
      name: 'tracker',
      setup() {},
      onBeforeUpdate() {
        order.push('before');
      },
      onUpdate() {
        order.push('update');
      },
    });
    await engine.advance(0.016);
    expect(order).toEqual(['before', 'update']);
  });

  it('onBeforeUpdate from defineSystem is called each frame', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const spy = vi.fn();
    const system = defineSystem(() => {
      onBeforeUpdate(spy);
    });
    await engine.use(system);
    await engine.advance(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0.016);
  });

  it('onAfterUpdate from defineSystem is called each frame', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const spy = vi.fn();
    const system = defineSystem(() => {
      onAfterUpdate(spy);
    });
    await engine.use(system);
    await engine.advance(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0.016);
  });

  it('onRender from defineSystem is called each frame (no dt)', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const spy = vi.fn();
    const system = defineSystem(() => {
      onRender(spy);
    });
    await engine.use(system);
    await engine.advance(0.016);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('multiple callbacks registered for same hook all fire', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const calls: number[] = [];
    const system = defineSystem(() => {
      onUpdate(() => calls.push(1));
      onUpdate(() => calls.push(2));
      onUpdate(() => calls.push(3));
    });
    await engine.use(system);
    await engine.advance(0.016);
    expect(calls).toEqual([1, 2, 3]);
  });

  it('engine context is active inside setup() (useEngine works)', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let capturedInSetup: unknown;
    const system = defineSystem(() => {
      capturedInSetup = useEngine();
    });
    await engine.use(system);
    expect(capturedInSetup).toBe(engine);
  });

  it('engine context is active inside onUpdate() callback', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let capturedInUpdate: unknown;
    const system = defineSystem(() => {
      onUpdate(() => {
        capturedInUpdate = useEngine();
      });
    });
    await engine.use(system);
    await engine.advance(0.016);
    expect(capturedInUpdate).toBe(engine);
  });

  it('closures from setup are accessible in onUpdate', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const fakeService = { step: vi.fn() };
    (engine as unknown as { provide: (k: string, v: unknown) => void }).provide(
      'fakeService',
      fakeService,
    );

    const system = defineSystem(() => {
      const svc = (engine as unknown as { inject: (k: string) => typeof fakeService }).inject(
        'fakeService',
      );
      onUpdate((dt) => svc.step(dt));
    });
    await engine.use(system);
    await engine.advance(0.016);
    expect(fakeService.step).toHaveBeenCalledWith(0.016);
  });

  it('throws if onUpdate() is called outside defineSystem()', () => {
    expect(() => onUpdate(() => {})).toThrow();
  });

  it('throws if onBeforeUpdate() is called outside defineSystem()', () => {
    expect(() => onBeforeUpdate(() => {})).toThrow();
  });

  it('throws if onAfterUpdate() is called outside defineSystem()', () => {
    expect(() => onAfterUpdate(() => {})).toThrow();
  });

  it('throws if onRender() is called outside defineSystem()', () => {
    expect(() => onRender(() => {})).toThrow();
  });

  it('context is cleaned up after defineSystem setup — no leak', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const system = defineSystem(() => {
      onUpdate(() => {});
    });
    await engine.use(system);
    // After setup, calling onUpdate outside context should throw
    expect(() => onUpdate(() => {})).toThrow();
  });

  it('deduplicates plugins by name — setup only called once', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const setupSpy = vi.fn();
    const system = defineSystem(function dedupSystem() {
      setupSpy();
    });
    await engine.use(system);
    await engine.use(system);
    expect(setupSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── useQuery() ──────────────────────────────────────────────────────────────

describe('useQuery()', () => {
  it('throws GwenContextError when called outside engine context', () => {
    engineContext.unset();
    expect(() => useQuery([])).toThrow(GwenContextError);
  });

  it('returns an iterable inside engine context', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    let result: Iterable<unknown> | null = null;
    engine.run(() => {
      result = useQuery([]);
    });
    expect(result).not.toBeNull();
    expect(typeof (result as unknown as Iterable<unknown>)[Symbol.iterator]).toBe('function');
  });
});

// ─── Performance ──────────────────────────────────────────────────────────────

describe('Performance', () => {
  it('10,000 useEngine() calls complete in < 0.5ms', async () => {
    const engine = await createEngine({ maxEntities: 100 });
    const start = performance.now();
    engine.run(() => {
      for (let i = 0; i < 10_000; i++) {
        useEngine();
      }
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(0.5);
  });
});
