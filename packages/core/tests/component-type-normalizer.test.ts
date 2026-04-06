import { describe, it, expect } from 'vitest';
import { defineComponent, Types } from '../src/schema';
import {
  buildQueryCacheKey,
  isComponentDefinition,
  normalizeComponentType,
  normalizeComponentTypesForQuery,
} from '../src/core/component-type-normalizer';

describe('component-type-normalizer', () => {
  const Position = defineComponent({
    name: 'Position',
    schema: { x: Types.f32, y: Types.f32 },
  });

  it('detects component definitions', () => {
    expect(isComponentDefinition(Position)).toBe(true);
    expect(isComponentDefinition('Position')).toBe(false);
    expect(isComponentDefinition(null)).toBe(false);
  });

  it('normalizes string and definition to the same name', () => {
    expect(normalizeComponentType('Position')).toBe('Position');
    expect(normalizeComponentType(Position)).toBe('Position');
  });

  it('throws for invalid inputs in strict mode', () => {
    expect(() => normalizeComponentType('')).toThrow('Component type must not be an empty string');
    expect(() => normalizeComponentType({ name: '' })).toThrow(
      'ComponentDefinition.name must not be empty',
    );
    expect(() => normalizeComponentType(undefined)).toThrow(
      'Invalid component type. Expected string or ComponentDefinition',
    );
  });

  it('returns empty string for invalid inputs in non-strict mode', () => {
    expect(normalizeComponentType('', false)).toBe('');
    expect(normalizeComponentType(undefined, false)).toBe('');
  });

  it('canonicalizes and sorts query inputs with deduplication', () => {
    const normalized = normalizeComponentTypesForQuery([
      Position,
      'Velocity',
      Position.name,
      'Velocity',
    ]);
    expect(normalized).toEqual(['Position', 'Velocity']);
  });

  it('builds deterministic cache keys', () => {
    const key = buildQueryCacheKey(['Position', 'Velocity']);
    expect(key).toBe('Position|Velocity');
  });
});
