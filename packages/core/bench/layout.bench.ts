/**
 * @file Performance benchmarks for the layout system (RFC-01).
 *
 * Measures the performance of core layout operations:
 * - Creating layout definitions
 * - Creating actor definitions
 *
 * All benchmarks measure pure TypeScript overhead without requiring WASM engine initialization.
 */

import { bench, describe } from 'vitest';
import { defineLayout } from '../src/scene/define-layout.js';
import { defineActor } from '../src/scene/define-actor.js';
import { definePrefab } from '../src/scene/define-prefab.js';

// Define a minimal prefab with one component
const Position = { __name__: 'Position' };
const SimpleActor = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe('Layout System — Layout definition creation', () => {
  /**
   * Bench: Create a layout definition with 50 actors.
   *
   * Measures the overhead of:
   * - Creating actor definitions
   * - Creating a layout definition object
   *
   * Does NOT measure layout execution (which requires engine context).
   * This isolates the TypeScript factory creation overhead.
   */
  bench('defineLayout with 50 actor variants', () => {
    const _actors = Array.from({ length: 50 }, (_, i) =>
      defineActor(SimpleActor, () => ({ id: i })),
    );
    const _Layout = defineLayout(() => {
      const refs: Record<string, unknown> = {};
      for (let i = 0; i < 50; i++) {
        refs[`actor${i}`] = { entityId: BigInt(i + 1) };
      }
      return refs;
    });
  });

  /**
   * Bench: Create 10 actor definitions sequentially.
   *
   * Measures the cost of defineActor when creating many actor variants.
   * Pure TypeScript operation with no WASM dependency.
   */
  bench('defineActor × 10', () => {
    for (let i = 0; i < 10; i++) {
      defineActor(SimpleActor, () => ({ id: i }));
    }
  });

  /**
   * Bench: Create 50 actor definitions sequentially.
   *
   * Bulk actor definition overhead.
   */
  bench('defineActor × 50', () => {
    for (let i = 0; i < 50; i++) {
      defineActor(SimpleActor, () => ({ id: i }));
    }
  });

  /**
   * Bench: Create 100 actor definitions sequentially.
   *
   * Large-scale actor definition overhead.
   */
  bench('defineActor × 100', () => {
    for (let i = 0; i < 100; i++) {
      defineActor(SimpleActor, () => ({ id: i }));
    }
  });
});

describe('Layout System — Factory object construction', () => {
  /**
   * Bench: Construct a refs object with 50 entries.
   *
   * Simulates the refs object construction that happens inside a layout factory.
   * Measures pure JavaScript object construction overhead.
   */
  bench('build refs object — 50 entries', () => {
    const refs: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      refs[`item${i}`] = { entityId: BigInt(i + 1) };
    }
  });

  /**
   * Bench: Construct a refs object with 100 entries.
   *
   * Large refs object construction overhead.
   */
  bench('build refs object — 100 entries', () => {
    const refs: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      refs[`item${i}`] = { entityId: BigInt(i + 1) };
    }
  });
});
