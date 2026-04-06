/**
 * Binary protocol round-trip tests.
 *
 * Covers the full serialize → DataView → deserialize cycle for every schema type.
 * These tests are the primary guard against binary protocol regressions: a wrong
 * DataView method, bad byte offset, or endianness mismatch would be caught here
 * before it could ever reach the WASM bridge.
 *
 * No mocks needed — `computeSchemaLayout` is a pure function.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeSchemaLayout, Types, defineComponent } from '../src/schema';
import { GlobalStringPoolManager } from '../src/utils/string-pool.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Allocate a DataView large enough for `byteLength`, pre-filled with zeros. */
function makeView(byteLength: number): DataView {
  return new DataView(new ArrayBuffer(byteLength));
}

/** Serialize `data` into a fresh buffer and deserialize back. */
function roundTrip<T extends Record<string, unknown>>(
  schema: Parameters<typeof computeSchemaLayout>[0],
  data: T,
): T {
  const layout = computeSchemaLayout<any>(schema);
  const view = makeView(layout.byteLength);
  layout.serialize!(data as any, view);
  return layout.deserialize!(view) as T;
}

// ── Byte layout verification ───────────────────────────────────────────────────

describe('byte layout', () => {
  it('f32 → 4 bytes', () => {
    const l = computeSchemaLayout({ v: Types.f32 });
    expect(l.byteLength).toBe(4);
  });

  it('f64 → 8 bytes', () => {
    const l = computeSchemaLayout({ v: Types.f64 });
    expect(l.byteLength).toBe(8);
  });

  it('i32 → 4 bytes', () => {
    const l = computeSchemaLayout({ v: Types.i32 });
    expect(l.byteLength).toBe(4);
  });

  it('u32 → 4 bytes', () => {
    const l = computeSchemaLayout({ v: Types.u32 });
    expect(l.byteLength).toBe(4);
  });

  it('i64 → 8 bytes', () => {
    const l = computeSchemaLayout({ v: Types.i64 });
    expect(l.byteLength).toBe(8);
  });

  it('u64 → 8 bytes', () => {
    const l = computeSchemaLayout({ v: Types.u64 });
    expect(l.byteLength).toBe(8);
  });

  it('bool → 1 byte', () => {
    const l = computeSchemaLayout({ v: Types.bool });
    expect(l.byteLength).toBe(1);
  });

  it('string → 4 bytes (int32 pool key)', () => {
    const l = computeSchemaLayout({ v: Types.string });
    expect(l.byteLength).toBe(4);
  });

  it('vec2 → 8 bytes (2 × f32)', () => {
    const l = computeSchemaLayout({ v: Types.vec2 });
    expect(l.byteLength).toBe(8);
  });

  it('vec3 → 12 bytes (3 × f32)', () => {
    const l = computeSchemaLayout({ v: Types.vec3 });
    expect(l.byteLength).toBe(12);
  });

  it('vec4 → 16 bytes (4 × f32)', () => {
    const l = computeSchemaLayout({ v: Types.vec4 });
    expect(l.byteLength).toBe(16);
  });

  it('quat → 16 bytes (4 × f32)', () => {
    const l = computeSchemaLayout({ v: Types.quat });
    expect(l.byteLength).toBe(16);
  });

  it('color → 16 bytes (4 × f32)', () => {
    const l = computeSchemaLayout({ v: Types.color });
    expect(l.byteLength).toBe(16);
  });

  it('multi-field component accumulates correctly', () => {
    // 4 + 4 + 1 + 4 (string) = 13 bytes
    const l = computeSchemaLayout({
      x: Types.f32,
      y: Types.f32,
      alive: Types.bool,
      tag: Types.string,
    });
    expect(l.byteLength).toBe(13);
  });
});

// ── Scalar round-trips ─────────────────────────────────────────────────────────

describe('f32 round-trip', () => {
  it('zero', () => {
    const { v } = roundTrip({ v: Types.f32 }, { v: 0 });
    expect(v).toBeCloseTo(0, 4);
  });

  it('positive fractional', () => {
    const { v } = roundTrip({ v: Types.f32 }, { v: 1.5 });
    expect(v).toBeCloseTo(1.5, 4);
  });

  it('negative fractional', () => {
    const { v } = roundTrip({ v: Types.f32 }, { v: -42.75 });
    expect(v).toBeCloseTo(-42.75, 4);
  });

  it('large integer', () => {
    const { v } = roundTrip({ v: Types.f32 }, { v: 1_000_000 });
    expect(v).toBeCloseTo(1_000_000, 0);
  });
});

describe('f64 round-trip', () => {
  it('zero', () => {
    const { v } = roundTrip({ v: Types.f64 }, { v: 0 });
    expect(v).toBe(0);
  });

  it('pi — full precision', () => {
    const { v } = roundTrip({ v: Types.f64 }, { v: Math.PI });
    expect(v).toBeCloseTo(Math.PI, 10);
  });

  it('negative large', () => {
    const { v } = roundTrip({ v: Types.f64 }, { v: -1e100 });
    expect(v).toBe(-1e100);
  });
});

describe('i32 round-trip', () => {
  it('zero', () => {
    expect(roundTrip({ v: Types.i32 }, { v: 0 }).v).toBe(0);
  });

  it('max int32', () => {
    expect(roundTrip({ v: Types.i32 }, { v: 2147483647 }).v).toBe(2147483647);
  });

  it('min int32', () => {
    expect(roundTrip({ v: Types.i32 }, { v: -2147483648 }).v).toBe(-2147483648);
  });
});

describe('u32 round-trip', () => {
  it('zero', () => {
    expect(roundTrip({ v: Types.u32 }, { v: 0 }).v).toBe(0);
  });

  it('max uint32', () => {
    expect(roundTrip({ v: Types.u32 }, { v: 4294967295 }).v).toBe(4294967295);
  });
});

describe('bool round-trip', () => {
  it('true', () => {
    expect(roundTrip({ v: Types.bool }, { v: true }).v).toBe(true);
  });

  it('false', () => {
    expect(roundTrip({ v: Types.bool }, { v: false }).v).toBe(false);
  });
});

describe('string round-trip', () => {
  beforeEach(() => {
    // Reset the scene string pool so IDs are deterministic across tests
    GlobalStringPoolManager.scene.reset?.();
  });

  it('empty string', () => {
    const { v } = roundTrip({ v: Types.string }, { v: '' });
    expect(v).toBe('');
  });

  it('ascii string', () => {
    const { v } = roundTrip({ v: Types.string }, { v: 'hello world' });
    expect(v).toBe('hello world');
  });

  it('multiple distinct strings keep separate identities', () => {
    const schema = { a: Types.string, b: Types.string };
    const result = roundTrip(schema, { a: 'alpha', b: 'beta' });
    expect(result.a).toBe('alpha');
    expect(result.b).toBe('beta');
  });
});

// ── Composite spatial type round-trips ────────────────────────────────────────

describe('vec2 round-trip', () => {
  it('typical 2D position', () => {
    const { v } = roundTrip({ v: Types.vec2 }, { v: { x: 1.5, y: -2.5 } });
    expect((v as any).x).toBeCloseTo(1.5, 4);
    expect((v as any).y).toBeCloseTo(-2.5, 4);
  });

  it('zero vector', () => {
    const { v } = roundTrip({ v: Types.vec2 }, { v: { x: 0, y: 0 } });
    expect((v as any).x).toBe(0);
    expect((v as any).y).toBe(0);
  });

  it('missing field defaults to 0', () => {
    // Passing an incomplete object — missing y should not throw; defaults to 0
    const { v } = roundTrip({ v: Types.vec2 }, { v: { x: 3 } });
    expect((v as any).x).toBeCloseTo(3, 4);
    expect((v as any).y).toBe(0);
  });
});

describe('vec3 round-trip', () => {
  it('3D position', () => {
    const { v } = roundTrip({ v: Types.vec3 }, { v: { x: 1, y: 2, z: 3 } });
    expect((v as any).x).toBeCloseTo(1, 4);
    expect((v as any).y).toBeCloseTo(2, 4);
    expect((v as any).z).toBeCloseTo(3, 4);
  });
});

describe('vec4 round-trip', () => {
  it('vec4 with w component', () => {
    const { v } = roundTrip({ v: Types.vec4 }, { v: { x: 0.1, y: 0.2, z: 0.3, w: 0.4 } });
    expect((v as any).x).toBeCloseTo(0.1, 4);
    expect((v as any).y).toBeCloseTo(0.2, 4);
    expect((v as any).z).toBeCloseTo(0.3, 4);
    expect((v as any).w).toBeCloseTo(0.4, 4);
  });
});

describe('quat round-trip', () => {
  it('identity quaternion', () => {
    const { v } = roundTrip({ v: Types.quat }, { v: { x: 0, y: 0, z: 0, w: 1 } });
    expect((v as any).x).toBeCloseTo(0, 6);
    expect((v as any).y).toBeCloseTo(0, 6);
    expect((v as any).z).toBeCloseTo(0, 6);
    expect((v as any).w).toBeCloseTo(1, 6);
  });

  it('non-trivial rotation', () => {
    const angle = Math.PI / 4;
    const s = Math.sin(angle / 2);
    const c = Math.cos(angle / 2);
    const { v } = roundTrip({ v: Types.quat }, { v: { x: 0, y: s, z: 0, w: c } });
    expect((v as any).y).toBeCloseTo(s, 4);
    expect((v as any).w).toBeCloseTo(c, 4);
  });
});

describe('color round-trip', () => {
  it('opaque red', () => {
    const { v } = roundTrip({ v: Types.color }, { v: { r: 1, g: 0, b: 0, a: 1 } });
    expect((v as any).r).toBeCloseTo(1, 5);
    expect((v as any).g).toBeCloseTo(0, 5);
    expect((v as any).b).toBeCloseTo(0, 5);
    expect((v as any).a).toBeCloseTo(1, 5);
  });

  it('semi-transparent grey', () => {
    const { v } = roundTrip({ v: Types.color }, { v: { r: 0.5, g: 0.5, b: 0.5, a: 0.5 } });
    expect((v as any).r).toBeCloseTo(0.5, 4);
    expect((v as any).a).toBeCloseTo(0.5, 4);
  });
});

// ── Multi-field component round-trips ─────────────────────────────────────────

describe('multi-field component round-trips', () => {
  it('Position { x: f32, y: f32 }', () => {
    const layout = computeSchemaLayout({ x: Types.f32, y: Types.f32 });
    expect(layout.byteLength).toBe(8);
    const view = makeView(8);
    layout.serialize!({ x: 100.5, y: -33.25 }, view);
    const result = layout.deserialize!(view);
    expect((result as any).x).toBeCloseTo(100.5, 4);
    expect((result as any).y).toBeCloseTo(-33.25, 4);
  });

  it('Transform3D { position: vec3, rotation: quat, scale: vec3 } — 48 bytes', () => {
    const schema = { position: Types.vec3, rotation: Types.quat, scale: Types.vec3 };
    const layout = computeSchemaLayout(schema);
    expect(layout.byteLength).toBe(12 + 16 + 12); // = 40 bytes
    const data = {
      position: { x: 5, y: 0, z: -3 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 2, y: 2, z: 2 },
    };
    const view = makeView(layout.byteLength);
    layout.serialize!(data, view);
    const result = layout.deserialize!(view) as typeof data;
    expect(result.position.x).toBeCloseTo(5, 4);
    expect(result.position.z).toBeCloseTo(-3, 4);
    expect(result.rotation.w).toBeCloseTo(1, 5);
    expect(result.scale.x).toBeCloseTo(2, 4);
  });

  it('Stats { health: i32, active: bool } — mixed types', () => {
    const schema = { health: Types.i32, active: Types.bool };
    const layout = computeSchemaLayout(schema);
    expect(layout.byteLength).toBe(5); // 4 + 1
    const view = makeView(layout.byteLength);
    layout.serialize!({ health: 100, active: true }, view);
    const result = layout.deserialize!(view) as { health: number; active: boolean };
    expect(result.health).toBe(100);
    expect(result.active).toBe(true);
  });

  it('full mixed component preserves all fields independently', () => {
    const schema = { a: Types.f32, b: Types.bool, c: Types.f32 };
    const data = { a: 1.5, b: true, c: 3.75 };
    const result = roundTrip(schema, data) as typeof data;
    expect(result.a).toBeCloseTo(1.5, 4);
    expect(result.b).toBe(true);
    expect(result.c).toBeCloseTo(3.75, 4);
  });
});

// ── Field offset isolation ────────────────────────────────────────────────────

describe('field offset isolation', () => {
  it('writing field a does not corrupt field c across a bool', () => {
    const schema = { a: Types.f32, b: Types.bool, c: Types.f32 };
    const layout = computeSchemaLayout(schema);
    const view = makeView(layout.byteLength);

    // Write only 'a' and 'c', leave 'b' default
    layout.serialize!({ a: 99.9, b: false, c: -77.7 }, view);
    const result = layout.deserialize!(view) as { a: number; b: boolean; c: number };
    expect(result.a).toBeCloseTo(99.9, 4);
    expect(result.b).toBe(false);
    expect(result.c).toBeCloseTo(-77.7, 4);
  });

  it('two adjacent vec2 fields do not bleed into each other', () => {
    const schema = { p: Types.vec2, v: Types.vec2 };
    const layout = computeSchemaLayout(schema);
    expect(layout.byteLength).toBe(16);
    const view = makeView(16);
    layout.serialize!({ p: { x: 1, y: 2 }, v: { x: 3, y: 4 } }, view);
    const result = layout.deserialize!(view) as {
      p: { x: number; y: number };
      v: { x: number; y: number };
    };
    expect(result.p.x).toBeCloseTo(1, 5);
    expect(result.p.y).toBeCloseTo(2, 5);
    expect(result.v.x).toBeCloseTo(3, 5);
    expect(result.v.y).toBeCloseTo(4, 5);
  });

  it('three scalars at consecutive offsets are independently readable', () => {
    const schema = { x: Types.i32, y: Types.i32, z: Types.i32 };
    const view = makeView(12);
    const layout = computeSchemaLayout(schema);
    layout.serialize!({ x: 1, y: 2, z: 3 }, view);
    // Manually verify the offsets in the raw buffer
    expect(view.getInt32(0, true)).toBe(1);
    expect(view.getInt32(4, true)).toBe(2);
    expect(view.getInt32(8, true)).toBe(3);
  });
});

// ── hasString flag ────────────────────────────────────────────────────────────

describe('hasString flag', () => {
  it('is false when no string fields', () => {
    const layout = computeSchemaLayout({ x: Types.f32, y: Types.f32 });
    expect(layout.hasString).toBe(false);
  });

  it('is true when a string field is present', () => {
    const layout = computeSchemaLayout({ name: Types.string, hp: Types.f32 });
    expect(layout.hasString).toBe(true);
  });
});

// ── defineComponent integration ───────────────────────────────────────────────

describe('defineComponent + computeSchemaLayout integration', () => {
  it('component schema produces correct layout for known shape', () => {
    const Velocity = defineComponent({
      name: 'velocity',
      schema: { vx: Types.f32, vy: Types.f32 },
    });
    const layout = computeSchemaLayout(Velocity.schema);
    expect(layout.byteLength).toBe(8);

    const view = makeView(8);
    layout.serialize!({ vx: 2.5, vy: -1.0 }, view);
    const result = layout.deserialize!(view) as { vx: number; vy: number };
    expect(result.vx).toBeCloseTo(2.5, 4);
    expect(result.vy).toBeCloseTo(-1.0, 5);
  });
});
