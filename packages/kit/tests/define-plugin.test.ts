/**
 * @gwenjs/kit — definePlugin() unit tests (RFC-002).
 *
 * Tests the factory-function API: `definePlugin(factory)` returns a typed
 * `PluginFactory` function. Calling that factory (with or without options)
 * produces a plain plugin object conforming to the RFC-001 `GwenPlugin`
 * interface (`setup(engine)` / `teardown()` / `onUpdate(dt)` …).
 */

import { describe, it, expect, vi } from 'vitest';
import { definePlugin } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a minimal `GwenEngine`-compatible mock for use in plugin tests.
 * All methods are replaced with `vi.fn()` stubs.
 */
function mockEngine(): GwenEngine {
  return {
    provide: vi.fn(),
    inject: vi.fn(),
    tryInject: vi.fn(),
    use: vi.fn(),
    unuse: vi.fn(),
    hooks: { hook: vi.fn(), callHook: vi.fn() },
    wasmBridge: {
      physics2d: { enabled: false, enable: vi.fn(), disable: vi.fn(), step: vi.fn() },
      physics3d: { enabled: false, enable: vi.fn(), disable: vi.fn(), step: vi.fn() },
    },
  } as unknown as GwenEngine;
}

// ─── TS-only plugin ───────────────────────────────────────────────────────────

describe('definePlugin() — TS-only plugin', () => {
  it('returns a factory function', () => {
    const MyPlugin = definePlugin(() => ({ name: 'MyPlugin', setup: vi.fn() }));
    expect(typeof MyPlugin).toBe('function');
  });

  it('calling the factory returns a defined plugin object', () => {
    const MyPlugin = definePlugin(() => ({ name: 'MyPlugin', setup: vi.fn() }));
    expect(MyPlugin()).toBeDefined();
  });

  it('instance name matches the definition', () => {
    const MyPlugin = definePlugin(() => ({ name: 'MyPlugin', setup: vi.fn() }));
    const p = MyPlugin();
    expect(p.name).toBe('MyPlugin');
  });

  it('version field is forwarded', () => {
    const P = definePlugin(() => ({ name: 'P', version: '1.2.3', setup: vi.fn() }));
    expect(P().version).toBe('1.2.3');
  });

  it('plugin has no wasm property', () => {
    const P = definePlugin(() => ({ name: 'P', setup: vi.fn() }));
    expect((P() as any).wasm).toBeUndefined();
  });

  it('setup() is called with the engine argument', () => {
    const setup = vi.fn();
    const P = definePlugin(() => ({ name: 'P', setup }));
    const engine = mockEngine();
    P().setup(engine);
    expect(setup).toHaveBeenCalledWith(engine);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it('setup() can call engine.provide()', () => {
    const engine = mockEngine();
    const P = definePlugin(() => ({
      name: 'P',
      setup(e: GwenEngine) {
        (e as ReturnType<typeof mockEngine>).provide('audio' as never, {} as never);
      },
    }));
    P().setup(engine);
    expect((engine as ReturnType<typeof mockEngine>).provide).toHaveBeenCalledTimes(1);
  });

  it('teardown() is called', () => {
    const teardown = vi.fn();
    const P = definePlugin(() => ({ name: 'P', setup: vi.fn(), teardown }));
    P().teardown!();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('onUpdate() receives the dt argument (no api param)', () => {
    const onUpdate = vi.fn();
    const P = definePlugin(() => ({ name: 'P', setup: vi.fn(), onUpdate }));
    P().onUpdate!(0.016);
    expect(onUpdate).toHaveBeenCalledWith(0.016);
  });

  it('onAfterUpdate() receives the dt argument', () => {
    const onAfterUpdate = vi.fn();
    const P = definePlugin(() => ({ name: 'P', setup: vi.fn(), onAfterUpdate }));
    P().onAfterUpdate!(0.033);
    expect(onAfterUpdate).toHaveBeenCalledWith(0.033);
  });

  it('onRender() is called with no arguments', () => {
    const onRender = vi.fn();
    const P = definePlugin(() => ({ name: 'P', setup: vi.fn(), onRender }));
    P().onRender!();
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('options are forwarded to the factory', () => {
    let captured: { volume?: number } = {};
    const P = definePlugin((opts: { volume?: number } = {}) => {
      captured = opts;
      return { name: 'P', setup: vi.fn() };
    });
    P({ volume: 0.5 });
    expect(captured.volume).toBe(0.5);
  });

  it('each factory call produces independent closure state', () => {
    const P = definePlugin(() => {
      let count = 0;
      return {
        name: 'Counter',
        setup: vi.fn(),
        onUpdate() {
          count++;
        },
        getCount() {
          return count;
        },
      };
    });

    const p1 = P();
    const p2 = P();

    p1.onUpdate!(0.016);
    p1.onUpdate!(0.016);
    p2.onUpdate!(0.016);

    // TypeScript: p1 and p2 are the inferred return types with getCount()
    expect((p1 as typeof p1 & { getCount(): number }).getCount()).toBe(2);
    expect((p2 as typeof p2 & { getCount(): number }).getCount()).toBe(1);
  });

  it('setup closure state persists across lifecycle calls', () => {
    const log: string[] = [];
    const P = definePlugin(() => ({
      name: 'Stateful',
      setup(_e: GwenEngine) {
        log.push('setup');
      },
      onUpdate(_dt: number) {
        log.push('update');
      },
      teardown() {
        log.push('teardown');
      },
    }));

    const p = P();
    p.setup(mockEngine());
    p.onUpdate!(0.016);
    p.teardown!();

    expect(log).toEqual(['setup', 'update', 'teardown']);
  });
});

// ─── Options variants ─────────────────────────────────────────────────────────

describe('definePlugin() — options variants', () => {
  it('void options — Plugin() with no args', () => {
    const P = definePlugin(() => ({ name: 'P', setup: vi.fn() }));
    expect(() => P()).not.toThrow();
  });

  it('optional options — Plugin() OR Plugin(opts)', () => {
    let received: { x?: number } | undefined;
    const P = definePlugin((opts?: { x?: number }) => {
      received = opts;
      return { name: 'P', setup: vi.fn() };
    });
    P();
    expect(received).toBeUndefined();
    P({ x: 42 });
    expect(received?.x).toBe(42);
  });

  it('required options — Plugin(opts) passes values to factory', () => {
    const P = definePlugin((opts: { speed: number }) => ({
      name: 'Mover',
      setup: vi.fn(),
      getSpeed() {
        return opts.speed;
      },
    }));
    const p = P({ speed: 5 });
    expect((p as typeof p & { getSpeed(): number }).getSpeed()).toBe(5);
  });

  it('multiple independent instances from same factory', () => {
    const P = definePlugin((opts: { id: string }) => ({
      name: `Plugin-${opts.id}`,
      setup: vi.fn(),
    }));
    const p1 = P({ id: 'alpha' });
    const p2 = P({ id: 'beta' });
    expect(p1.name).toBe('Plugin-alpha');
    expect(p2.name).toBe('Plugin-beta');
  });
});
