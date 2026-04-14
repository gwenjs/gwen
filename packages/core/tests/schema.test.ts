import { describe, it, expect } from "vitest";
import { defineComponent, Types } from "../src/schema";
import type { InferComponent } from "../src/schema";

describe("DSL Components (schema.ts)", () => {
  // ── Form 1 — direct object ────────────────────────────────────────────────

  it("form 1 — defines a component correctly", () => {
    const Health = defineComponent({
      name: "Health",
      schema: {
        current: Types.f32,
        max: Types.f32,
        isPoisoned: Types.bool,
        name: Types.string,
      },
    });

    expect(Health.name).toBe("Health");
    expect(Health.schema.current).toBe(Types.f32);
    expect(Health.schema.isPoisoned).toBe(Types.bool);

    const h: InferComponent<typeof Health> = {
      current: 100,
      max: 100,
      isPoisoned: false,
      name: "Player 1",
    };
    expect(h.current).toBe(100);
  });

  // ── Form 2 — factory ─────────────────────────────────────────────────────

  it("form 2 — factory: name extracted correctly", () => {
    const Position = defineComponent("position", () => ({
      schema: { x: Types.f32, y: Types.f32 },
    }));
    expect(Position.name).toBe("position");
    expect(Position.schema.x).toBe(Types.f32);
    expect(Position.schema.y).toBe(Types.f32);
  });

  it("form 2 — factory: called exactly once", () => {
    let calls = 0;
    const def = defineComponent("test", () => {
      calls++;
      return { schema: { v: Types.i32 } };
    });
    expect(calls).toBe(1);
    expect(def.name).toBe("test");
  });

  it("form 2 — factory: InferComponent works", () => {
    const Velocity = defineComponent("velocity", () => ({
      schema: { vx: Types.f32, vy: Types.f32 },
    }));
    const v: InferComponent<typeof Velocity> = { vx: 1.5, vy: -2.0 };
    expect(v.vx).toBeCloseTo(1.5);
  });
});

describe("defineComponent metadata", () => {
  it("assigns a unique _typeId per component", () => {
    const A = defineComponent({ name: "A", schema: { x: Types.f32 } });
    const B = defineComponent({ name: "B", schema: { x: Types.f32 } });
    expect(typeof A._typeId).toBe("number");
    expect(typeof B._typeId).toBe("number");
    expect(A._typeId).not.toBe(B._typeId);
  });

  it("computes _byteSize from schema fields", () => {
    const C = defineComponent({
      name: "C",
      schema: { x: Types.f32, y: Types.f32 },
    });
    // 2 × f32 = 2 × 4 = 8
    expect(C._byteSize).toBe(8);
  });

  it("computes _f32Stride as _byteSize / 4", () => {
    const D = defineComponent({
      name: "D",
      schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
    });
    // 3 × 4 = 12 bytes → stride 3
    expect(D._f32Stride).toBe(3);
  });

  it("exposes _fields with name, type and byteOffset", () => {
    const E = defineComponent({
      name: "E",
      schema: { hp: Types.f32, mp: Types.i32 },
    });
    expect(E._fields).toEqual([
      { name: "hp", type: "f32", byteOffset: 0 },
      { name: "mp", type: "i32", byteOffset: 4 },
    ]);
  });
});

// ─── validateComponentSchema ──────────────────────────────────────────────────

describe("defineComponent — schema validation", () => {
  it("accepts a valid flat schema", () => {
    expect(() =>
      defineComponent({ name: "Valid", schema: { x: Types.f32, alive: Types.bool } }),
    ).not.toThrow();
  });

  it("throws when a field is a nested plain object instead of a SchemaType", () => {
    expect(() =>
      defineComponent({
        name: "Bad",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: { position: { x: Types.f32, y: Types.f32 } as any },
      }),
    ).toThrow(/Bad.*position.*nested|nested.*position.*Bad/i);
  });

  it("throws when a field value is a primitive (not a SchemaType object)", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineComponent({ name: "Prim", schema: { value: 42 as any } }),
    ).toThrow(/Prim.*value/i);
  });

  it("throws when a field value is null", () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      defineComponent({ name: "Null", schema: { field: null as any } }),
    ).toThrow(/Null.*field/i);
  });

  it("includes the component name and field name in the error message", () => {
    expect(() =>
      defineComponent({
        name: "MyComp",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        schema: { badField: { nested: Types.f32 } as any },
      }),
    ).toThrow(/MyComp/);
  });
});
