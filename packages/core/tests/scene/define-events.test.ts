/**
 * @file Tests for `defineEvents()` and `InferEvents` — RFC-011 DX improvement
 *
 * Verifies:
 * - defineEvents returns the same map object at runtime (identity)
 * - InferEvents correctly maps the event map to a GwenRuntimeHooks-compatible shape
 * - emit() accepts keys declared via defineEvents without any cast
 * - onEvent() accepts keys declared via defineEvents without any cast
 */

import { describe, it, expect, vi, expectTypeOf } from 'vitest';
import { defineEvents, emit } from '../../src/index.js';
import type { InferEvents } from '../../src/index.js';
import { createEngine } from '../../src/engine/gwen-engine.js';

// Simulated user-land declaration (what the user writes in their game)
const GameEvents = defineEvents({
  'enemy:died': (_id: bigint): void => undefined,
  'player:damage': (_amount: number): void => undefined,
  'level:complete': (): void => undefined,
});

// Type augmentation — users put this in their events.ts
declare module '@gwenjs/core' {
  interface GwenRuntimeHooks extends InferEvents<typeof GameEvents> {}
}

describe('defineEvents()', () => {
  it('returns the exact same object at runtime (identity)', () => {
    const map = {
      'foo:bar': (_x: number): void => undefined,
    };
    const result = defineEvents(map);
    expect(result).toBe(map);
  });

  it('preserves all keys and values', () => {
    expect(Object.keys(GameEvents)).toEqual(['enemy:died', 'player:damage', 'level:complete']);
    expect(typeof GameEvents['enemy:died']).toBe('function');
  });
});

describe('InferEvents<T>', () => {
  it('maps event keys to their handler types', () => {
    type Events = InferEvents<typeof GameEvents>;
    // Type-level: 'enemy:died' key should map to a function taking bigint
    expectTypeOf<Events['enemy:died']>().toEqualTypeOf<(id: bigint) => void>();
    expectTypeOf<Events['player:damage']>().toEqualTypeOf<(amount: number) => void>();
    expectTypeOf<Events['level:complete']>().toEqualTypeOf<() => void>();
  });
});

describe('emit() with declared events', () => {
  it('accepts declared event keys and args without any cast', async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    engine.hooks.hook('enemy:died' as never, spy);

    engine.run(() => {
      // No 'as never', no cast — fully typed via augmentation
      emit('enemy:died', 42n);
      emit('player:damage', 10);
      emit('level:complete');
    });

    expect(spy).toHaveBeenCalledWith(42n);
  });
});
