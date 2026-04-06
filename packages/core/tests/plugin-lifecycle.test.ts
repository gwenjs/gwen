/**
 * RFC-001: engine.use / engine.unuse lifecycle tests
 */
import { describe, it, expect, vi } from 'vitest';
import { createEngine, GwenPluginNotFoundError } from '../src/index';

declare module '../src/index' {
  interface GwenProvides {
    testSvc: { value: number };
  }
}

describe('engine.use / engine.unuse', () => {
  it('calls setup with engine instance', async () => {
    const engine = await createEngine();
    const setup = vi.fn();
    await engine.use({ name: 'P', setup });
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ use: expect.any(Function) }));
  });

  it('deduplicates by name — second use() is a no-op', async () => {
    const engine = await createEngine();
    const setup = vi.fn();
    const plugin = { name: 'P', setup };
    await engine.use(plugin);
    await engine.use(plugin);
    expect(setup).toHaveBeenCalledOnce();
  });

  it('awaits async setup before resolving', async () => {
    const engine = await createEngine();
    let resolved = false;
    await engine.use({
      name: 'Async',
      async setup() {
        await new Promise<void>((r) => setTimeout(r, 10));
        resolved = true;
      },
    });
    expect(resolved).toBe(true);
  });

  it('calls teardown on unuse()', async () => {
    const engine = await createEngine();
    const teardown = vi.fn();
    await engine.use({ name: 'T', setup() {}, teardown });
    await engine.unuse('T');
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('unuse() unknown name is a no-op', async () => {
    const engine = await createEngine();
    await expect(engine.unuse('Unknown')).resolves.toBeUndefined();
  });

  it('all 4 frame hooks called in order', async () => {
    const calls: string[] = [];
    const engine = await createEngine();
    await engine.use({
      name: 'Hooks',
      setup() {},
      onBeforeUpdate() {
        calls.push('before');
      },
      onUpdate() {
        calls.push('update');
      },
      onAfterUpdate() {
        calls.push('after');
      },
      onRender() {
        calls.push('render');
      },
    });
    await engine.advance(1 / 60);
    expect(calls).toEqual(['before', 'update', 'after', 'render']);
  });

  it('setup overhead < 5ms for no-op plugin', async () => {
    const engine = await createEngine();
    const t = performance.now();
    await engine.use({ name: 'Perf', setup() {} });
    expect(performance.now() - t).toBeLessThan(5);
  });
});

describe('engine.provide / inject / tryInject', () => {
  it('inject() returns provided value', async () => {
    const engine = await createEngine();
    engine.provide('testSvc', { value: 42 });
    expect(engine.inject('testSvc')).toEqual({ value: 42 });
  });

  it('inject() throws GwenPluginNotFoundError when absent', async () => {
    const engine = await createEngine();
    expect(() => engine.inject('testSvc')).toThrow(GwenPluginNotFoundError);
  });

  it('GwenPluginNotFoundError has plugin, hint, docsUrl', async () => {
    const engine = await createEngine();
    try {
      engine.inject('testSvc');
    } catch (e) {
      expect(e).toBeInstanceOf(GwenPluginNotFoundError);
      const err = e as GwenPluginNotFoundError;
      expect(err.pluginName).toBe('testSvc');
      expect(err.hint.length).toBeGreaterThan(0);
      expect(err.docsUrl).toMatch(/^https?:\/\//);
    }
  });

  it('tryInject() returns undefined when absent', async () => {
    const engine = await createEngine();
    expect(engine.tryInject('testSvc')).toBeUndefined();
  });
});

describe('engine.advance()', () => {
  it('caps delta time at maxDeltaSeconds', async () => {
    const dts: number[] = [];
    const engine = await createEngine({ maxDeltaSeconds: 0.05 });
    await engine.use({
      name: 'dt',
      setup() {},
      onUpdate(dt) {
        dts.push(dt);
      },
    });
    await engine.advance(1000); // 1000ms (1s) > 50ms cap (maxDeltaSeconds=0.05s → 50ms)
    expect(dts[0]).toBe(50); // capped to 0.05 * 1000 = 50ms
  });

  it('throws on re-entrant advance()', async () => {
    const engine = await createEngine();
    let secondCallError: Error | null = null;
    await engine.use({
      name: 'reentrant',
      setup() {},
      onUpdate() {
        engine.advance(0.016).catch((e: Error) => {
          secondCallError = e;
        });
      },
    });
    await engine.advance(0.016);
    expect(secondCallError).not.toBeNull();
    expect((secondCallError as unknown as Error).message).toMatch(/re-entrantly/);
  });
});
