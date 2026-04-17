import { describe, it, expect } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from "../../src/system/runtime/define-system";

describe("system lifecycle composables — context guard", () => {
  it("onUpdate throws outside context", () => {
    expect(() => onUpdate(() => {})).toThrow("[GWEN] onUpdate()");
  });
  it("onBeforeUpdate throws outside context", () => {
    expect(() => onBeforeUpdate(() => {})).toThrow("[GWEN] onBeforeUpdate()");
  });
  it("onAfterUpdate throws outside context", () => {
    expect(() => onAfterUpdate(() => {})).toThrow("[GWEN] onAfterUpdate()");
  });
  it("onRender throws outside context", () => {
    expect(() => onRender(() => {})).toThrow("[GWEN] onRender()");
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
