/**
 * @file Integration — full engine lifecycle: createEngine → use(plugin) → start → advance(dt) → stop.
 *
 * These tests exercise the end-to-end pipeline without mocking internal engine
 * internals, verifying that the public API composes correctly across package boundaries.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEngine } from '../../src/index.js';
import type { GwenPlugin } from '../../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a plugin that records its lifecycle phase invocations. */
function makeRecorder(name: string, log: string[]): GwenPlugin {
  return {
    name,
    setup(_engine) {
      log.push(`${name}:setup`);
    },
    onBeforeUpdate(dt) {
      log.push(`${name}:beforeUpdate:${dt}`);
    },
    onUpdate(dt) {
      log.push(`${name}:update:${dt}`);
    },
    onAfterUpdate(dt) {
      log.push(`${name}:afterUpdate:${dt}`);
    },
    onRender() {
      log.push(`${name}:render`);
    },
    teardown() {
      log.push(`${name}:teardown`);
    },
  };
}

// ─── Core lifecycle ───────────────────────────────────────────────────────────

describe('Engine lifecycle — createEngine → use → advance → unuse', () => {
  it('setup runs synchronously during engine.use()', async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder('A', log));
    expect(log).toContain('A:setup');
  });

  it('all frame phases receive the dt value from advance()', async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder('B', log));

    await engine.advance(16);

    expect(log).toContain('B:beforeUpdate:16');
    expect(log).toContain('B:update:16');
    expect(log).toContain('B:afterUpdate:16');
    expect(log).toContain('B:render');
  });

  it('frame phases execute in order: beforeUpdate → update → afterUpdate → render', async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder('C', log));

    await engine.advance(16);

    const phases = log.filter((e) => e.startsWith('C:')).map((e) => e.split(':')[1]);
    expect(phases).toEqual(['setup', 'beforeUpdate', 'update', 'afterUpdate', 'render']);
  });

  it('teardown is called on engine.unuse()', async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder('D', log));
    await engine.unuse('D');
    expect(log).toContain('D:teardown');
  });

  it('plugin does not receive frame calls after unuse()', async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder('E', log));

    await engine.unuse('E');
    log.length = 0; // reset after teardown

    await engine.advance(16);
    expect(log).toHaveLength(0);
  });

  it('multiple plugins all receive frame calls in registration order', async () => {
    const engine = await createEngine();
    const updateOrder: string[] = [];

    await engine.use({
      name: 'first',
      setup() {},
      onUpdate() {
        updateOrder.push('first');
      },
    });
    await engine.use({
      name: 'second',
      setup() {},
      onUpdate() {
        updateOrder.push('second');
      },
    });
    await engine.use({
      name: 'third',
      setup() {},
      onUpdate() {
        updateOrder.push('third');
      },
    });

    await engine.advance(16);
    expect(updateOrder).toEqual(['first', 'second', 'third']);
  });

  it('advance() accumulates frameCount correctly over multiple ticks', async () => {
    const engine = await createEngine();
    expect(engine.frameCount).toBe(0);

    await engine.advance(16);
    expect(engine.frameCount).toBe(1);

    await engine.advance(16);
    await engine.advance(16);
    expect(engine.frameCount).toBe(3);
  });

  it('dt is capped to maxDeltaSeconds * 1000 ms', async () => {
    const dts: number[] = [];
    const engine = await createEngine({ maxDeltaSeconds: 0.05 }); // cap = 50 ms

    await engine.use({
      name: 'cap-check',
      setup() {},
      onUpdate(dt) {
        dts.push(dt);
      },
    });

    await engine.advance(10_000); // far above cap
    expect(dts[0]).toBe(50);
  });
});

// ─── startExternal() integration ─────────────────────────────────────────────

describe('Engine lifecycle — startExternal + advance', () => {
  it('startExternal() fires engine:init and engine:start hooks', async () => {
    const engine = await createEngine();
    const fired: string[] = [];

    engine.hooks.hook('engine:init', () => fired.push('init'));
    engine.hooks.hook('engine:start', () => fired.push('start'));

    await engine.startExternal();

    expect(fired).toContain('init');
    expect(fired).toContain('start');
  });

  it('plugins installed before startExternal() still receive frame calls', async () => {
    const engine = await createEngine();
    const calls: string[] = [];

    await engine.use({
      name: 'pre-start',
      setup() {},
      onUpdate() {
        calls.push('update');
      },
    });

    await engine.startExternal();
    await engine.advance(16);

    expect(calls).toContain('update');
  });

  it('plugins installed after startExternal() also receive frame calls', async () => {
    const engine = await createEngine();
    await engine.startExternal();

    const calls: string[] = [];
    await engine.use({
      name: 'post-start',
      setup() {},
      onUpdate() {
        calls.push('update');
      },
    });

    await engine.advance(16);
    expect(calls).toContain('update');
  });
});

// ─── provide / inject cross-plugin ───────────────────────────────────────────

describe('Engine lifecycle — provide / inject across plugins', () => {
  it('a plugin can provide a service that a second plugin injects during setup', async () => {
    const engine = await createEngine();

    // Plugin A provides a counter service
    await engine.use({
      name: 'provider',
      setup(eng) {
        eng.provide('counter' as never, { count: 0 });
      },
    });

    // Plugin B reads the service during its own setup
    let injectedCount: number | undefined;
    await engine.use({
      name: 'consumer',
      setup(eng) {
        // @ts-expect-error — dynamic key not in GwenProvides union in this test file
        const svc = eng.tryInject('counter') as { count: number } | undefined;
        injectedCount = svc?.count;
      },
    });

    expect(injectedCount).toBe(0);
  });
});

// ─── Engine:tick / engine:afterTick hooks ─────────────────────────────────────

describe('Engine lifecycle — engine hooks fire during advance()', () => {
  it('engine:tick fires once per advance() call', async () => {
    const engine = await createEngine();
    let ticks = 0;
    engine.hooks.hook('engine:tick', () => ticks++);

    await engine.advance(16);
    await engine.advance(16);

    expect(ticks).toBe(2);
  });

  it('engine:afterTick fires once per advance() call', async () => {
    const engine = await createEngine();
    let afterTicks = 0;
    engine.hooks.hook('engine:afterTick', () => afterTicks++);

    await engine.advance(16);
    await engine.advance(16);
    await engine.advance(16);

    expect(afterTicks).toBe(3);
  });

  it('engine:tick fires before plugin onUpdate, engine:afterTick fires after', async () => {
    const engine = await createEngine();
    const order: string[] = [];

    engine.hooks.hook('engine:tick', () => order.push('tick'));
    engine.hooks.hook('engine:afterTick', () => order.push('afterTick'));

    await engine.use({
      name: 'p',
      setup() {},
      onUpdate() {
        order.push('update');
      },
    });

    await engine.advance(16);

    expect(order.indexOf('tick')).toBeLessThan(order.indexOf('update'));
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('afterTick'));
  });
});
