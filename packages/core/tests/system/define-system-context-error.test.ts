import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/engine-factory";
import {
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
} from "../../src/system/runtime/define-system";

const OUTSIDE_SYSTEM =
  /^\[(onUpdate|onBeforeUpdate|onAfterUpdate|onRender)\(\)\] Called outside defineSystem\(\) or defineActor\(\)\.[\s\S]*\(CORE:OUTSIDE_SYSTEM_CONTEXT\)$/;

describe("system lifecycle composables — context guard", () => {
  it("onUpdate throws outside context", () => {
    expect(() => onUpdate(() => {})).toThrow(OUTSIDE_SYSTEM);
    expect(() => onUpdate(() => {})).toThrow("[onUpdate()]");
  });
  it("onBeforeUpdate throws outside context", () => {
    expect(() => onBeforeUpdate(() => {})).toThrow(OUTSIDE_SYSTEM);
    expect(() => onBeforeUpdate(() => {})).toThrow("[onBeforeUpdate()]");
  });
  it("onAfterUpdate throws outside context", () => {
    expect(() => onAfterUpdate(() => {})).toThrow(OUTSIDE_SYSTEM);
    expect(() => onAfterUpdate(() => {})).toThrow("[onAfterUpdate()]");
  });
  it("onRender throws outside context", () => {
    expect(() => onRender(() => {})).toThrow(OUTSIDE_SYSTEM);
    expect(() => onRender(() => {})).toThrow("[onRender()]");
  });
  it("onUpdate works inside defineSystem", async () => {
    const engine = await createEngine({});
    const calls: number[] = [];
    const { defineSystem } = await import("../../src/system/runtime/define-system");
    const Sys = defineSystem("TestSys", () => {
      onUpdate((dt) => calls.push(dt));
    });
    await engine.use(Sys());
    await engine.advance(0.016);
    expect(calls).toEqual([0.016]);
    await engine.stop();
  });
});
