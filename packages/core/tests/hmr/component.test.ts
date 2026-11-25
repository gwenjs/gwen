import { afterEach, describe, expect, it } from "vitest";
import { componentRegistryFor } from "../../src/engine/engine-component-registry";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { hotCompareComponent } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { defineComponent, Types } from "../../src/schema";

const engines: GwenEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

describe("hotCompareComponent", () => {
  it("same name and fields is applied with count 0", () => {
    const prev = defineComponent({ name: "Pos", schema: { hp: Types.f32, mp: Types.f32 } });
    const next = defineComponent({ name: "Pos", schema: { hp: Types.f32, mp: Types.f32 } });

    expect(hotCompareComponent(prev, next)).toEqual({
      status: "applied",
      kind: "component",
      name: "Pos",
      count: 0,
    });
  });

  it("a changed byteOffset reports component-layout-changed naming the field", () => {
    const prev = defineComponent({ name: "Pos", schema: { hp: Types.f32, mp: Types.f32 } });
    const reordered = defineComponent({ name: "Pos", schema: { mp: Types.f32, hp: Types.f32 } });
    const retyped = defineComponent({ name: "Pos", schema: { hp: Types.i32, mp: Types.f32 } });
    const grown = defineComponent({
      name: "Pos",
      schema: { hp: Types.f32, mp: Types.f32, sp: Types.f32 },
    });
    const shrunk = defineComponent({ name: "Pos", schema: { hp: Types.f32 } });

    expect(hotCompareComponent(prev, reordered)).toEqual({
      status: "reload",
      kind: "component",
      name: "Pos",
      reason: "component-layout-changed",
      detail: 'field "hp": byteOffset 0 -> 4',
    });
    expect(hotCompareComponent(prev, retyped)).toEqual({
      status: "reload",
      kind: "component",
      name: "Pos",
      reason: "component-layout-changed",
      detail: 'field "hp": type f32 -> i32',
    });
    expect(hotCompareComponent(prev, grown)).toEqual({
      status: "reload",
      kind: "component",
      name: "Pos",
      reason: "component-layout-changed",
      detail: 'field "sp" added',
    });
    expect(hotCompareComponent(prev, shrunk)).toEqual({
      status: "reload",
      kind: "component",
      name: "Pos",
      reason: "component-layout-changed",
      detail: 'field "mp" removed',
    });
  });

  it("a renamed component reports component-layout-changed", () => {
    const prev = defineComponent({ name: "Pos", schema: { hp: Types.f32 } });
    const next = defineComponent({ name: "Position", schema: { hp: Types.f32 } });

    expect(hotCompareComponent(prev, next)).toEqual({
      status: "reload",
      kind: "component",
      name: "Pos",
      reason: "component-layout-changed",
      detail: 'name "Pos" -> "Position"',
    });
  });

  it("a redefinition with the same layout keeps the engine type id", async () => {
    const prev = defineComponent({ name: "Pos", schema: { hp: Types.f32, mp: Types.f32 } });
    const next = defineComponent({ name: "Pos", schema: { hp: Types.f32, mp: Types.f32 } });
    const engine = await createEngine();
    engines.push(engine);
    const registry = componentRegistryFor(engine);
    const prevId = registry.getOrRegister(prev);

    expect(hotCompareComponent(prev, next)).toEqual({
      status: "applied",
      kind: "component",
      name: "Pos",
      count: 0,
    });
    expect(registry.getOrRegister(next)).toBe(prevId);
  });
});
