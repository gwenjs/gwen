/**
 * Tests for Physics3D plugin configuration normalization.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PHYSICS3D_CONFIG,
  normalizePhysics3DConfig,
  buildLayerRegistry,
  resolveLayerBits,
} from '../src/config';
import { QUALITY_PRESETS } from '../src/types';

describe('normalizePhysics3DConfig', () => {
  it('applies full defaults on empty input', () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg).toEqual(DEFAULT_PHYSICS3D_CONFIG);
  });

  it('overrides gravity components independently', () => {
    const cfg = normalizePhysics3DConfig({ gravity: { y: -3, z: 2 } });
    expect(cfg.gravity.x).toBe(0);
    expect(cfg.gravity.y).toBe(-3);
    expect(cfg.gravity.z).toBe(2);
  });

  it('overrides maxEntities', () => {
    const cfg = normalizePhysics3DConfig({ maxEntities: 2048 });
    expect(cfg.maxEntities).toBe(2048);
    expect(cfg.gravity).toEqual(DEFAULT_PHYSICS3D_CONFIG.gravity);
  });

  it('defaults qualityPreset to medium', () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.qualityPreset).toBe('medium');
  });

  it('accepts all quality preset values', () => {
    for (const preset of ['low', 'medium', 'high', 'esport'] as const) {
      const cfg = normalizePhysics3DConfig({ qualityPreset: preset });
      expect(cfg.qualityPreset).toBe(preset);
    }
  });

  it('defaults debug to false', () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.debug).toBe(false);
  });

  it('enables debug mode', () => {
    const cfg = normalizePhysics3DConfig({ debug: true });
    expect(cfg.debug).toBe(true);
  });

  it('defaults coalesceEvents to true', () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.coalesceEvents).toBe(true);
  });

  it('allows disabling coalesceEvents', () => {
    const cfg = normalizePhysics3DConfig({ coalesceEvents: false });
    expect(cfg.coalesceEvents).toBe(false);
  });

  it('defaults layers to empty array', () => {
    const cfg = normalizePhysics3DConfig();
    expect(cfg.layers).toEqual([]);
  });

  it('stores provided layer names', () => {
    const cfg = normalizePhysics3DConfig({ layers: ['default', 'player', 'enemy'] });
    expect(cfg.layers).toEqual(['default', 'player', 'enemy']);
  });
});

describe('QUALITY_PRESETS', () => {
  it('maps preset names to numeric codes', () => {
    expect(QUALITY_PRESETS.low).toBe(0);
    expect(QUALITY_PRESETS.medium).toBe(1);
    expect(QUALITY_PRESETS.high).toBe(2);
    expect(QUALITY_PRESETS.esport).toBe(3);
  });
});

describe('buildLayerRegistry', () => {
  it('maps each layer name to its bit position', () => {
    const reg = buildLayerRegistry(['default', 'player', 'enemy']);
    expect(reg.get('default')).toBe(1);
    expect(reg.get('player')).toBe(2);
    expect(reg.get('enemy')).toBe(4);
  });

  it('caps at 32 layers', () => {
    const names = Array.from({ length: 40 }, (_, i) => `layer${i}`);
    const reg = buildLayerRegistry(names);
    expect(reg.size).toBe(32);
  });

  it('returns empty map for empty input', () => {
    expect(buildLayerRegistry([])).toEqual(new Map());
  });
});

describe('resolveLayerBits', () => {
  const registry = buildLayerRegistry(['default', 'player', 'enemy', 'ground']);

  it('returns 0xFFFFFFFF for undefined names', () => {
    expect(resolveLayerBits(undefined, registry)).toBe(0xffffffff);
  });

  it('returns 0xFFFFFFFF for empty array', () => {
    expect(resolveLayerBits([], registry)).toBe(0xffffffff);
  });

  it('resolves a single layer name', () => {
    expect(resolveLayerBits(['player'], registry)).toBe(2);
  });

  it('combines multiple layer names into a bitmask', () => {
    expect(resolveLayerBits(['default', 'enemy'], registry)).toBe(1 | 4);
  });

  it('throws on unknown layer names with a helpful message', () => {
    expect(() => resolveLayerBits(['unknown'], registry)).toThrow(
      '[GWEN:Physics3D] Unknown layer "unknown". Declared layers: [default, player, enemy, ground]',
    );
  });

  it('throws on first unknown in a mixed valid/invalid list', () => {
    expect(() => resolveLayerBits(['player', 'typo'], registry)).toThrow(
      '[GWEN:Physics3D] Unknown layer "typo"',
    );
  });

  it('produces unsigned 32-bit value', () => {
    const big = buildLayerRegistry(Array.from({ length: 32 }, (_, i) => `l${i}`));
    const result = resolveLayerBits(
      Array.from({ length: 32 }, (_, i) => `l${i}`),
      big,
    );
    expect(result >>> 0).toBe(result);
  });
});
