import { describe, it, expect } from 'vitest';
import { Types, computeSchemaLayout } from '../src/schema';

describe('computeSchemaLayout', () => {
  it('should compute exact byte size and offsets for numeric components', () => {
    const layout = computeSchemaLayout({
      x: Types.f32,
      y: Types.f32,
      health: Types.i32,
      alive: Types.bool,
    });

    expect(layout.byteLength).toBe(4 + 4 + 4 + 1); // 13 bytes
    expect(layout.hasString).toBe(false);
    expect(layout.serialize).toBeDefined();
    expect(layout.deserialize).toBeDefined();
  });

  it('should treat strings as i32 identifiers using StringPool', () => {
    const layout = computeSchemaLayout({
      x: Types.f32,
      name: Types.string,
    });

    expect(layout.hasString).toBe(true); // string field detected via StringPool
    expect(layout.serialize).toBeDefined();
    expect(layout.deserialize).toBeDefined();
  });

  it('should correctly serialize and deserialize using DataView', () => {
    const layout = computeSchemaLayout({
      speed: Types.f32,
      maxHp: Types.i32,
      isFlying: Types.bool,
    });

    const buffer = new ArrayBuffer(layout.byteLength);
    const view = new DataView(buffer);

    const data = {
      speed: 12.5,
      maxHp: 100,
      isFlying: true,
    };

    const bytesWritten = layout.serialize!(data, view);
    expect(bytesWritten).toBe(9); // 4 + 4 + 1

    const deserialized = layout.deserialize!(view);
    expect(deserialized.speed).toBeCloseTo(12.5);
    expect(deserialized.maxHp).toBe(100);
    expect(deserialized.isFlying).toBe(true);

    // Test reverse bool
    layout.serialize!({ speed: 0, maxHp: 0, isFlying: false }, view);
    const deserialized2 = layout.deserialize!(view);
    expect(deserialized2.isFlying).toBe(false);
  });
});
