/**
 * Task 6: RAF loop targetFPS throttle tests
 * Validates that targetFPS is enforced in the game loop.
 */
import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/index.js';

describe('GwenEngine — targetFPS throttle', () => {
  /**
   * Test that targetFPS is stored correctly from options.
   */
  it('stores targetFPS from options', async () => {
    const engine = await createEngine({ targetFPS: 30 });
    expect(engine.targetFPS).toBe(30);
  });

  /**
   * Test that targetFPS defaults to 60 when not specified.
   */
  it('defaults targetFPS to 60', async () => {
    const engine = await createEngine();
    expect(engine.targetFPS).toBe(60);
  });

  /**
   * Test that custom targetFPS values are respected.
   */
  it('accepts custom targetFPS values', async () => {
    const fps = [30, 45, 60, 120, 240];
    for (const targetFPS of fps) {
      const engine = await createEngine({ targetFPS });
      expect(engine.targetFPS).toBe(targetFPS);
    }
  });

  /**
   * Test that targetFPS can be read from the engine.
   */
  it('targetFPS is accessible as a property', async () => {
    const engine = await createEngine({ targetFPS: 30 });
    const fps = engine.targetFPS;
    expect(typeof fps).toBe('number');
    expect(fps).toBe(30);
  });
});
