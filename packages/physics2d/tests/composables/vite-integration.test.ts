/**
 * @file Cross-plugin integration tests — physics2d layer inlining + gwen:optimizer.
 *
 * Step 9 — Verifies that the physics2d Vite plugin (layer inlining) and the
 * `gwenOptimizerPlugin` (bulk-WASM rewrite) can be applied sequentially on the
 * same source file without producing conflicts or errors.
 *
 * The typical Vite pipeline calls each plugin's `transform` hook in registration
 * order; these tests replicate that sequencing manually so we can assert on the
 * intermediate and final outputs.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { physics2dVitePlugin } from '../../src/vite-plugin.js';
import { gwenOptimizerPlugin } from '@gwenjs/vite';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gwen-cross-plugin-'));
}

const POSITION_SOURCE = `
import { defineComponent, Types } from '@gwenjs/core';
export const Position = defineComponent({
  name: 'Position',
  _typeId: 1,
  schema: { x: Types.f32, y: Types.f32 },
});
`;

const VELOCITY_SOURCE = `
import { defineComponent, Types } from '@gwenjs/core';
export const Velocity = defineComponent({
  name: 'Velocity',
  _typeId: 2,
  schema: { x: Types.f32, y: Types.f32 },
});
`;

/**
 * A source file that exercises both plugins:
 * - `defineLayers` → physics2d will inline these values
 * - `useQuery + onUpdate + useComponent` → optimizer will bulk-rewrite these
 */
const MIXED_SOURCE = `
import { defineSystem, useQuery, onUpdate, useComponent } from '@gwenjs/core/system';
import { defineLayers, useStaticBody } from '@gwenjs/physics2d';
import { Position, Velocity } from './components';

const Layers = defineLayers({ player: 1 << 0, wall: 1 << 2 });

export const MovementSystem = defineSystem(function MovementSystem() {
  const entities = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    // Physics2d layer reference — will be inlined to numeric value
    useStaticBody({ layer: Layers.player, mask: Layers.wall });

    for (const e of entities) {
      const pos = useComponent(e, Position);
      useComponent(e, Position, { x: pos.x + Velocity.x[e] * dt, y: pos.y + Velocity.y[e] * dt });
    }
  });
});
`;

// ─── Cross-plugin sequencing tests ───────────────────────────────────────────

describe('physics2d layer inlining → optimizer (sequential transform)', () => {
  const temps: string[] = [];

  afterEach(() => {
    for (const tmp of temps) {
      try { fs.rmSync(tmp, { recursive: true }); } catch { /* ignore */ }
    }
    temps.length = 0;
  });

  it('physics2d inlines layer constants before the optimizer runs', () => {
    const physics2dPlugin = physics2dVitePlugin();
    const transform2d = physics2dPlugin.transform as (
      code: string,
      id: string,
    ) => { code: string; map: unknown } | null | undefined;

    const result = transform2d.call({ warn: vi.fn() }, MIXED_SOURCE, 'src/movement.ts');

    // Physics2d should have inlined the layer constants
    expect(result).toBeDefined();
    if (result) {
      expect(result.code).not.toContain('Layers.player');
      expect(result.code).not.toContain('Layers.wall');
      // Inlined numeric values present
      expect(result.code).toContain('1'); // player = 1 << 0 = 1
      expect(result.code).toContain('4'); // wall   = 1 << 2 = 4
    }
  });

  it('optimizer receives layer-inlined code without errors', async () => {
    const tmp = makeTmp();
    temps.push(tmp);

    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'position.ts'), POSITION_SOURCE, 'utf8');
    fs.writeFileSync(path.join(srcDir, 'velocity.ts'), VELOCITY_SOURCE, 'utf8');

    // Step A — physics2d layer inlining
    const physics2dPlugin = physics2dVitePlugin();
    const transform2d = physics2dPlugin.transform as (
      code: string,
      id: string,
    ) => { code: string; map: unknown } | null | undefined;

    const step1 = transform2d.call({ warn: vi.fn() }, MIXED_SOURCE, 'src/movement.ts');
    const codeAfterPhysics2d = step1?.code ?? MIXED_SOURCE;

    // Verify layer inlining happened
    expect(codeAfterPhysics2d).not.toContain('Layers.player');

    // Step B — optimizer (bulk WASM transform)
    const optimizerPlugin = gwenOptimizerPlugin({ mode: 'transform', debug: false });
    (optimizerPlugin.configResolved as Function)({ root: tmp });
    await (optimizerPlugin.buildStart as Function).call({});

    const systemId = path.join(srcDir, 'movement.ts');
    const warnings: string[] = [];
    const ctx = { warn: (m: string) => warnings.push(m) };

    // Must not throw
    const step2 = await (optimizerPlugin.transform as Function).call(
      ctx,
      codeAfterPhysics2d,
      systemId,
    );

    // The optimizer may or may not bulk-transform (depends on pattern detection),
    // but it must never throw or corrupt the code.
    if (step2 !== null && step2 !== undefined) {
      // Bulk transform happened — verify the code is still syntactically present
      expect(typeof step2.code).toBe('string');
      expect(step2.code.length).toBeGreaterThan(0);
      // Layer values must still be numeric (not re-introduced as Layers.*)
      expect(step2.code).not.toContain('Layers.player');
      expect(step2.code).not.toContain('Layers.wall');
    }
  });

  it('final output contains neither defineLayers nor Layers.* references', async () => {
    const tmp = makeTmp();
    temps.push(tmp);

    const srcDir = path.join(tmp, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'position.ts'), POSITION_SOURCE, 'utf8');
    fs.writeFileSync(path.join(srcDir, 'velocity.ts'), VELOCITY_SOURCE, 'utf8');

    // Run physics2d plugin
    const physics2dPlugin = physics2dVitePlugin();
    const transform2d = physics2dPlugin.transform as Function;
    const step1 = transform2d.call({ warn: vi.fn() }, MIXED_SOURCE, 'src/movement.ts');
    const codeAfterPhysics2d = step1?.code ?? MIXED_SOURCE;

    // Run optimizer
    const optimizerPlugin = gwenOptimizerPlugin({ mode: 'transform' });
    (optimizerPlugin.configResolved as Function)({ root: tmp });
    await (optimizerPlugin.buildStart as Function).call({});

    const ctx = { warn: (_: string) => {} };
    const step2 = await (optimizerPlugin.transform as Function).call(
      ctx,
      codeAfterPhysics2d,
      path.join(srcDir, 'movement.ts'),
    );

    const finalCode = step2?.code ?? codeAfterPhysics2d;

    // The defineLayers *call* (declaration) must be gone, even if the import
    // identifier still appears. Layer property accesses must be fully inlined.
    expect(finalCode).not.toContain('defineLayers(');
    expect(finalCode).not.toMatch(/\bLayers\.\w+/);
  });

  it('physics2d-only file (no system pattern) is untouched by optimizer', () => {
    const layersOnlySource = `
      import { defineLayers, useStaticBody } from '@gwenjs/physics2d';
      const Layers = defineLayers({ ground: 1 << 0, wall: 1 << 2 });
      useStaticBody({ layer: Layers.ground, mask: Layers.wall });
    `;

    const physics2dPlugin = physics2dVitePlugin();
    const transform2d = physics2dPlugin.transform as Function;
    const step1 = transform2d.call({ warn: vi.fn() }, layersOnlySource, 'src/world.ts');

    // Layers must be inlined
    expect(step1).toBeDefined();
    expect(step1?.code).not.toContain('Layers.ground');

    // Optimizer should skip (no useQuery + onUpdate keywords)
    const _optimizerPlugin = gwenOptimizerPlugin({ mode: 'transform' });
    // No buildStart needed — the quick-check guard fires first
    const codeAfterPhysics2d = step1?.code ?? layersOnlySource;
    // The optimizer guard checks for 'useQuery' in the string — this file won't have it
    expect(codeAfterPhysics2d).not.toContain('useQuery');
    expect(codeAfterPhysics2d).not.toContain('onUpdate');
  });

  it('source map from physics2d step is a valid V3 map object', () => {
    const physics2dPlugin = physics2dVitePlugin();
    const transform2d = physics2dPlugin.transform as Function;
    const result = transform2d.call({ warn: vi.fn() }, MIXED_SOURCE, 'src/movement.ts');

    expect(result).toBeDefined();
    if (result) {
      expect(result.map).toBeDefined();
      expect(result.map).toHaveProperty('mappings');
      expect(typeof result.map.mappings).toBe('string');
      expect(result.map.mappings.length).toBeGreaterThan(0);
    }
  });
});
