/**
 * Unit tests for ContextSlot — the generic save/restore context primitive.
 */
import { describe, it, expect } from "vitest";
import { ContextSlot } from "../../src/engine/context-slot";

describe("ContextSlot", () => {
  it("get() returns null outside a run() call", () => {
    const slot = new ContextSlot<number>();
    expect(slot.get()).toBeNull();
  });

  it("get() returns the active value inside run()", () => {
    const slot = new ContextSlot<string>();
    slot.run("hello", () => {
      expect(slot.get()).toBe("hello");
    });
  });

  it("isActive() returns false outside run()", () => {
    const slot = new ContextSlot<number>();
    expect(slot.isActive()).toBe(false);
  });

  it("isActive() returns true inside run()", () => {
    const slot = new ContextSlot<number>();
    slot.run(42, () => {
      expect(slot.isActive()).toBe(true);
    });
  });

  it("require() throws outside run()", () => {
    const slot = new ContextSlot<number>();
    expect(() => slot.require("must be inside run()")).toThrow("must be inside run()");
  });

  it("require() returns the value inside run()", () => {
    const slot = new ContextSlot<number>();
    slot.run(7, () => {
      expect(slot.require("err")).toBe(7);
    });
  });

  it("restores null after run() returns", () => {
    const slot = new ContextSlot<number>();
    slot.run(1, () => {});
    expect(slot.get()).toBeNull();
  });

  it("restores previous value after nested run()", () => {
    const slot = new ContextSlot<number>();
    slot.run(1, () => {
      slot.run(2, () => {
        expect(slot.get()).toBe(2);
      });
      expect(slot.get()).toBe(1);
    });
    expect(slot.get()).toBeNull();
  });

  it("restores value even when fn throws", () => {
    const slot = new ContextSlot<number>();
    expect(() =>
      slot.run(99, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(slot.get()).toBeNull();
  });

  it("run() returns the return value of fn", () => {
    const slot = new ContextSlot<string>();
    const result = slot.run("ctx", () => 42);
    expect(result).toBe(42);
  });
});
