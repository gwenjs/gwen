/**
 * Lane mapping for EngineComponentRegistry.
 * The per-entity type cache is gone: component membership lives in the WASM rows.
 */

import { describe, it, expect } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { GwenScope } from "../src/context/scope";
import { EngineComponentRegistry } from "../src/engine/engine-component-registry";
import { createEngine } from "../src/node";
import * as EngineErrors from "../src/engine/engine-errors";
import { CoreErrorCodes, GwenWasmError } from "../src/engine/engine-errors";
import type { WasmBridge } from "../src/engine/wasm-bridge";
import { Types } from "../src/schema";

describe("EngineComponentRegistry lanes", () => {
  function recordingBridge(): { bridge: WasmBridge; seen: number[][] } {
    const seen: number[][] = [];
    const recorded = {
      isActive: () => true,
      registerComponent: (lanes: Uint8Array) => {
        seen.push(Array.from(lanes));
        return seen.length;
      },
      hasComponent: (_index: number, _generation: number, _typeId: number) => false,
    };
    const bridge = recorded as WasmBridge;
    return { bridge, seen };
  }

  it("maps each Types entry and a string name onto lane kinds", () => {
    const { bridge, seen } = recordingBridge();
    const registry = new EngineComponentRegistry(bridge);
    const cases = [
      { field: Types.f32, lanes: [0] },
      { field: Types.f64, lanes: [1] },
      { field: Types.i32, lanes: [2] },
      { field: Types.u32, lanes: [3] },
      { field: Types.bool, lanes: [4] },
      { field: Types.i64, lanes: [5] },
      { field: Types.u64, lanes: [6] },
      { field: Types.string, lanes: [7] },
      { field: Types.persistentString, lanes: [7] },
      { field: Types.vec2, lanes: [0, 0] },
      { field: Types.vec3, lanes: [0, 0, 0] },
      { field: Types.vec4, lanes: [0, 0, 0, 0] },
      { field: Types.quat, lanes: [0, 0, 0, 0] },
      { field: Types.color, lanes: [0, 0, 0, 0] },
    ];
    registry.getOrRegister("Transform");
    for (const [index, item] of cases.entries()) {
      registry.getOrRegister({ name: `Lane${index}`, schema: { value: item.field } });
    }
    registry.getOrRegister({
      name: "Ordered",
      schema: { y: Types.f32, flag: Types.bool },
    });
    expect(seen).toEqual([[0], ...cases.map((item) => item.lanes), [0, 4]]);
  });

  it("rejects the same name when the lanes differ and keeps the first id", () => {
    const { bridge, seen } = recordingBridge();
    const registry = new EngineComponentRegistry(bridge);
    const first = registry.getOrRegister({ name: "Same", schema: { a: Types.f32 } });
    let caught: unknown;
    try {
      registry.getOrRegister({ name: "Same", schema: { a: Types.f64 } });
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_LAYOUT_INVALID);
    expect(registry.get("Same")).toBe(first);
    expect(seen).toEqual([[0]]);
  });
});

function gwenComponentLimitError(): unknown {
  return Reflect.get(EngineErrors, "GwenComponentLimitError");
}

function isErrorClass(value: unknown): value is new (...args: never[]) => Error {
  return typeof value === "function";
}

function handBridge(): {
  bridge: WasmBridge;
  released: number[];
  failRegister: { error: GwenWasmError | null };
  active: { value: boolean };
} {
  const released: number[] = [];
  const failRegister: { error: GwenWasmError | null } = { error: null };
  const active = { value: true };
  let next = 1;
  const recorded = {
    isActive: () => active.value,
    registerComponent: (lanes: Uint8Array) => {
      if (lanes.byteLength < 0) return 0;
      if (failRegister.error !== null) throw failRegister.error;
      const id = next;
      next += 1;
      return id;
    },
    releaseComponent: (typeId: number) => {
      released.push(typeId);
    },
  };
  return { bridge: recorded as WasmBridge, released, failRegister, active };
}

describe("EngineComponentRegistry release", () => {
  it("release returns true and forgets the name when the bridge accepts", () => {
    const { bridge, released } = handBridge();
    const registry = new EngineComponentRegistry(bridge);
    expect(typeof registry.release).toBe("function");
    const id = registry.getOrRegister("Alpha");
    expect(registry.release("Alpha")).toBe(true);
    expect(released).toEqual([id]);
    expect(registry.get("Alpha")).toBeUndefined();
  });

  it("release returns false and keeps the name on CORE:COMPONENT_TYPE_IN_USE", () => {
    const { released } = handBridge();
    const inUse = new GwenWasmError(
      CoreErrorCodes.COMPONENT_TYPE_IN_USE,
      "component type 1 still has rows",
      "release_component",
      undefined,
    );
    const recorded = {
      isActive: () => true,
      registerComponent: (lanes: Uint8Array): number => {
        if (lanes.byteLength < 0) return 0;
        return 1;
      },
      releaseComponent: (typeId: number): void => {
        released.push(typeId);
        throw inUse;
      },
    };
    const registry = new EngineComponentRegistry(recorded as WasmBridge);
    expect(typeof registry.release).toBe("function");
    const id = registry.getOrRegister("Kept");
    let caught: unknown;
    let result = true;
    try {
      result = registry.release("Kept");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeUndefined();
    expect(result).toBe(false);
    expect(registry.get("Kept")).toBe(id);
    expect(released).toEqual([id]);
  });

  it("release of an unknown name returns false", () => {
    const { bridge, released } = handBridge();
    const registry = new EngineComponentRegistry(bridge);
    expect(typeof registry.release).toBe("function");
    expect(registry.release("Missing")).toBe(false);
    expect(released).toEqual([]);
  });

  it("the limit error carries component, owner, max and used", () => {
    const { bridge } = handBridge();
    const registry = new EngineComponentRegistry(bridge);
    const LimitError = gwenComponentLimitError();
    expect(typeof LimitError).toBe("function");
    if (!isErrorClass(LimitError)) return;
    for (let i = 1; i <= 128; i += 1) registry.getOrRegister(`Full${i}`);
    let caught: unknown;
    try {
      registry.getOrRegister("Full129");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LimitError);
    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    expect(caught).toMatchObject({
      component: "Full129",
      owner: null,
      max: 128,
      used: 128,
      code: CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED,
    });
    expect(registry.get("Full129")).toBeUndefined();
  });

  it("owner is the nearest plugin scope's meta.name", async () => {
    const { bridge } = handBridge();
    const registry = new EngineComponentRegistry(bridge);
    const LimitError = gwenComponentLimitError();
    expect(typeof LimitError).toBe("function");
    if (!isErrorClass(LimitError)) return;
    for (let i = 1; i <= 128; i += 1) registry.getOrRegister(`Base${i}`);
    const engine = await createEngine({ maxEntities: 100 });
    const plugin = new GwenScope(engine, { type: "plugin", name: "p" });
    const child = new GwenScope(engine, { type: "actor", name: "child" }, plugin);
    let caught: unknown;
    try {
      child.run(() => {
        try {
          registry.getOrRegister("FromChild");
        } catch (error: unknown) {
          caught = error;
        }
      });
    } finally {
      child.dispose();
      plugin.dispose();
      await engine.stop();
    }
    expect(caught).toBeInstanceOf(LimitError);
    expect(caught).toMatchObject({ component: "FromChild", owner: "p", max: 128, used: 128 });
    expect(registry.get("FromChild")).toBeUndefined();
  });

  it("release on the mock path (bridge inactive) returns true and frees the local id", () => {
    const hand = handBridge();
    hand.active.value = false;
    const registry = new EngineComponentRegistry(hand.bridge);
    expect(typeof registry.release).toBe("function");
    for (let i = 1; i <= 128; i += 1) registry.getOrRegister(`Local${i}`);
    expect(registry.usedCount()).toBe(128);
    expect(registry.release("Local1")).toBe(true);
    expect(hand.released).toEqual([]);
    expect(registry.usedCount()).toBe(127);
    expect(registry.get("Local1")).toBeUndefined();
    const next = registry.getOrRegister("Local129");
    expect(typeof next).toBe("number");
    expect(registry.usedCount()).toBe(128);
  });

  it("the WASM path catches GwenWasmError CORE:COMPONENT_TYPE_LIMIT_REACHED and rethrows GwenComponentLimitError with cause set", () => {
    const hand = handBridge();
    const wasmError = new GwenWasmError(
      CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED,
      "limit",
      "register_component",
      undefined,
    );
    hand.failRegister.error = wasmError;
    const registry = new EngineComponentRegistry(hand.bridge);
    const LimitError = gwenComponentLimitError();
    expect(typeof LimitError).toBe("function");
    if (!isErrorClass(LimitError)) return;
    let caught: unknown;
    try {
      registry.getOrRegister("Boom");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LimitError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    expect(caught).toMatchObject({ max: 128, used: 128 });
    expect(typeof caught).toBe("object");
    if (typeof caught !== "object" || caught === null) return;
    expect(Reflect.get(caught, "cause")).toBe(wasmError);
    expect(registry.get("Boom")).toBeUndefined();
    expect(registry.usedCount()).toBe(0);

    const other = new GwenWasmError(
      CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
      "bad layout",
      "register_component",
      undefined,
    );
    hand.failRegister.error = other;
    let passed: unknown;
    try {
      registry.getOrRegister("Other");
    } catch (error: unknown) {
      passed = error;
    }
    expect(passed).toBe(other);
    expect(registry.get("Other")).toBeUndefined();
  });

  it("release rethrows a wasm error that is not COMPONENT_TYPE_IN_USE", () => {
    const layout = new GwenWasmError(
      CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
      "bad layout",
      "release_component",
      undefined,
    );
    const recorded = {
      isActive: () => true,
      registerComponent: (lanes: Uint8Array): number => {
        if (lanes.byteLength < 0) return 0;
        return 7;
      },
      releaseComponent: (_typeId: number): void => {
        throw layout;
      },
    };
    const registry = new EngineComponentRegistry(recorded as WasmBridge);
    expect(typeof registry.release).toBe("function");
    const id = registry.getOrRegister("Named");
    let caught: unknown;
    try {
      registry.release("Named");
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(layout);
    expect(registry.get("Named")).toBe(id);
  });
});
