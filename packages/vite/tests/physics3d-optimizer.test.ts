import { describe, it, expect, vi } from 'vitest';
import { gwenPhysics3DOptimizerPlugin } from '../src/plugins/physics3d-optimizer';
import type { GwenPhysics3DOptimizerOptions } from '../src/plugins/physics3d-optimizer';

const PHYSICS_SOURCE = `
import { defineSystem, onUpdate } from '@gwenjs/core';
import { usePhysics3D } from '@gwenjs/physics3d';

export const raycastSystem = defineSystem(() => {
  const physics = usePhysics3D();

  onUpdate((dt) => {
    const hit = physics.castRay({ origin: [0, 0, 0], direction: [0, -1, 0] });
  });
});
`;

const NON_PHYSICS_SOURCE = `
import { defineSystem, onUpdate } from '@gwenjs/core';

export const movementSystem = defineSystem(() => {
  onUpdate((dt) => {
    console.log('update', dt);
  });
});
`;

describe('gwenPhysics3DOptimizerPlugin', () => {
  it('has name "gwen:physics3d-optimizer"', () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    expect(plugin.name).toBe('gwen:physics3d-optimizer');
  });

  it('has a transform function', () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    expect(typeof plugin.transform).toBe('function');
  });

  it('accepts options without throwing', () => {
    const options: GwenPhysics3DOptimizerOptions = {
      mode: 'warn',
      debug: false,
      extensions: ['.ts'],
    };
    expect(() => gwenPhysics3DOptimizerPlugin(options)).not.toThrow();
  });

  it('does not process non-TS files — returns null for .css', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    const result = await (plugin.transform as Function).call({}, 'const x = 1', 'file.css');
    expect(result).toBeNull();
  });

  it('does not process non-TS files — returns null for .vue', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    const result = await (plugin.transform as Function).call({}, PHYSICS_SOURCE, 'system.vue');
    expect(result).toBeNull();
  });

  it('returns null quickly for files without physics calls', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    const result = await (plugin.transform as Function).call(
      { warn: () => {} },
      NON_PHYSICS_SOURCE,
      'system.ts',
    );
    expect(result).toBeNull();
  });

  it('returns null (no source modification) for files with physics calls — Phase 1 warn only', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    const warns: string[] = [];
    const result = await (plugin.transform as Function).call(
      { warn: (msg: string) => warns.push(msg) },
      PHYSICS_SOURCE,
      'system.ts',
    );
    expect(result).toBeNull();
  });

  it('calls this.warn for detected physics query anti-patterns', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    const warns: string[] = [];
    await (plugin.transform as Function).call(
      { warn: (msg: string) => warns.push(msg) },
      PHYSICS_SOURCE,
      'system.ts',
    );
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('castRay');
    expect(warns[0]).toContain('onUpdate');
  });

  it('respects custom extensions — skips .tsx when only .ts configured', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin({ extensions: ['.ts'] });
    const result = await (plugin.transform as Function).call(
      { warn: () => {} },
      PHYSICS_SOURCE,
      'system.tsx',
    );
    expect(result).toBeNull();
  });

  it('processes .tsx files with default extensions', async () => {
    const plugin = gwenPhysics3DOptimizerPlugin();
    const warns: string[] = [];
    const result = await (plugin.transform as Function).call(
      { warn: (msg: string) => warns.push(msg) },
      PHYSICS_SOURCE,
      'system.tsx',
    );
    expect(result).toBeNull();
    expect(warns.length).toBeGreaterThan(0);
  });

  it('logs a fallback warning when mode is "transform" (not yet implemented)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      gwenPhysics3DOptimizerPlugin({ mode: 'transform' });
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0]![0]).toContain('mode: "transform" is not yet implemented');
      expect(warnSpy.mock.calls[0]![0]).toContain('Falling back to mode: "warn"');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
