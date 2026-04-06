/**
 * RFC-003: Scoped hooks proxy — hooks auto-removed on unuse()
 */
import { describe, it, expect, vi } from 'vitest';
import { createEngine } from '../src/index';

describe('Scoped hooks proxy', () => {
  it('plugin hooks are called after use()', async () => {
    const engine = await createEngine();
    const fn = vi.fn();
    await engine.use({
      name: 'HP',
      setup(eng) {
        eng.hooks.hook('engine:tick', fn);
      },
    });
    await engine.advance(0.016);
    expect(fn).toHaveBeenCalled();
  });

  it('plugin hooks removed after unuse()', async () => {
    const engine = await createEngine();
    const fn = vi.fn();
    await engine.use({
      name: 'HP2',
      setup(eng) {
        eng.hooks.hook('engine:tick', fn);
      },
    });
    await engine.unuse('HP2');
    await engine.advance(0.016);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not leak hooks from other plugins', async () => {
    const engine = await createEngine();
    const fnA = vi.fn();
    const fnB = vi.fn();
    await engine.use({
      name: 'A',
      setup(eng) {
        eng.hooks.hook('engine:tick', fnA);
      },
    });
    await engine.use({
      name: 'B',
      setup(eng) {
        eng.hooks.hook('engine:tick', fnB);
      },
    });
    await engine.unuse('A');
    await engine.advance(0.016);
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalled();
  });

  it('engine:tick hook fires before onBeforeUpdate', async () => {
    const order: string[] = [];
    const engine = await createEngine();
    engine.hooks.hook('engine:tick', () => {
      order.push('tick');
    });
    await engine.use({
      name: 'ord',
      setup() {},
      onBeforeUpdate() {
        order.push('before');
      },
    });
    await engine.advance(0.016);
    expect(order[0]).toBe('tick');
    expect(order[1]).toBe('before');
  });

  it('engine:afterTick fires after onRender', async () => {
    const order: string[] = [];
    const engine = await createEngine();
    await engine.use({
      name: 'ord2',
      setup() {},
      onRender() {
        order.push('render');
      },
    });
    engine.hooks.hook('engine:afterTick', () => {
      order.push('afterTick');
    });
    await engine.advance(0.016);
    const renderIdx = order.indexOf('render');
    const afterIdx = order.indexOf('afterTick');
    expect(renderIdx).toBeGreaterThanOrEqual(0);
    expect(afterIdx).toBeGreaterThan(renderIdx);
  });
});
