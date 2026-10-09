import { describe, expect, it } from "vitest";

import { createEngine, defineComponent, Types } from "../src/index";

const Marker = defineComponent({
  name: "Marker",
  schema: { value: Types.f32 },
  defaults: { value: 0 },
});

describe("engine state", () => {
  it("starts idle, becomes running, then stopped", async () => {
    const engine = await createEngine();
    const seen: Array<{ from: string; to: string; reason: string }> = [];
    engine.hooks.hook("engine:state-change", (event) => {
      seen.push(event);
    });

    expect(engine.state).toBe("idle");
    await engine.startExternal();
    expect(engine.state).toBe("running");
    await engine.stop();
    expect(engine.state).toBe("stopped");
    expect(seen).toEqual([
      { from: "idle", to: "starting", reason: "USER" },
      { from: "starting", to: "running", reason: "USER" },
      { from: "running", to: "stopping", reason: "USER" },
      { from: "stopping", to: "stopped", reason: "USER" },
    ]);
  });

  it("rejects a second startExternal while running", async () => {
    const engine = await createEngine();
    await engine.startExternal();
    await expect(engine.startExternal()).rejects.toThrow(/running/);
    expect(engine.state).toBe("running");
  });

  it("throws on start and advance after a wasm panic", async () => {
    const engine = await createEngine();
    let updates = 0;
    engine.hooks.hook("engine:update", () => {
      updates += 1;
      throw new WebAssembly.RuntimeError("panic");
    });

    const id = engine.createEntity();
    engine.addComponent(id, Marker, { value: 1 });

    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(engine.state).toBe("faulted");
    expect(updates).toBe(1);
    await expect(engine.advance(1 / 60)).rejects.toThrow(/faulted/);
    await expect(engine.start()).rejects.toThrow(/faulted/);
    await expect(engine.startExternal()).rejects.toThrow(/faulted/);
    await expect(engine.unuse("missing")).rejects.toThrow(/faulted/);
    expect(() => engine.createEntity()).toThrow(/faulted/);
    expect(() => engine.destroyEntity(id)).toThrow(/faulted/);
    expect(() => engine.addComponent(id, Marker, { value: 2 })).toThrow(/faulted/);
    expect(() => engine.removeComponent(id, Marker)).toThrow(/faulted/);
    expect(() => engine.provide("logger", engine.logger)).toThrow(/faulted/);
    expect(() => engine.activate()).toThrow(/faulted/);
    expect(() => engine.deactivate()).toThrow(/faulted/);
    expect(() => engine.run(() => 1)).toThrow(/faulted/);
    await expect(
      engine.loadWasmModule({ name: "late", url: "https://example.invalid/late.wasm" }),
    ).rejects.toThrow(/faulted/);
    let setups = 0;
    await expect(
      engine.use({
        name: "late",
        setup() {
          setups += 1;
        },
      }),
    ).rejects.toThrow(/faulted/);
    expect(setups).toBe(0);
    expect(updates).toBe(1);
    expect(engine.isAlive(id)).toBe(true);
    expect(engine.hasComponent(id, Marker)).toBe(true);
    expect(engine.getComponent(id, Marker)?.value).toBe(1);
    expect(engine.state).toBe("faulted");
    expect(engine.deltaTime).toBeTypeOf("number");
    expect(engine.getFPS()).toBeTypeOf("number");
    await engine.stop();
  });
});
