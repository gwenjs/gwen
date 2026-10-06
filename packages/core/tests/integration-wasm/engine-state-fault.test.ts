import { describe, expect, it } from "vitest";

import { CoreErrorCodes, GwenEngineStateError } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

/** Minimal module: `(func (export "trap") unreachable)`. */
const TRAP_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02,
  0x01, 0x00, 0x07, 0x08, 0x01, 0x04, 0x74, 0x72, 0x61, 0x70, 0x00, 0x00, 0x0a, 0x05, 0x01, 0x03,
  0x00, 0x00, 0x0b,
]);

describe("engine state fault", () => {
  it("an executed unreachable traps into faulted and stop stays there", async () => {
    const { engine } = await createRealEngine({ variant: "light", maxEntities: 8 });
    const mod = await WebAssembly.instantiate(TRAP_WASM);
    const trap = mod.instance.exports["trap"];
    if (typeof trap !== "function") {
      throw new Error("trap export missing");
    }
    const changes: Array<{ from: string; to: string; reason: string }> = [];
    const panics: string[] = [];
    engine.hooks.hook("engine:state-change", (payload) => {
      changes.push({ from: payload.from, to: payload.to, reason: payload.reason });
    });
    engine.errors.on((event) => {
      if (event.code === CoreErrorCodes.WASM_PANIC) panics.push(event.code);
    });
    engine.hooks.hook("engine:before-update", () => {
      trap();
    });

    await engine.startExternal();
    await engine.advance(1 / 60);

    expect(engine.state).toBe("faulted");
    expect(changes).toContainEqual({ from: "running", to: "faulted", reason: "WASM_PANIC" });
    expect(panics).toEqual([CoreErrorCodes.WASM_PANIC]);
    await expect(engine.advance(1 / 60)).rejects.toMatchObject({
      code: CoreErrorCodes.INVALID_STATE_TRANSITION,
    });
    await expect(engine.advance(1 / 60)).rejects.toBeInstanceOf(GwenEngineStateError);
    await engine.stop();
    expect(engine.state).toBe("faulted");
  });
});
