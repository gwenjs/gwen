/**
 * stop() still serves the bridge to plugin teardown and disposables, then disposes an owned bridge.
 */
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

import { createEngine } from "../../src/index.js";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { createDisposable } from "../../src/disposable.js";

const DISPOSED_LINE = "[GWEN] The WASM bridge was disposed by engine.stop().";

function expectDisposed(caught: unknown): void {
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) return;
  expect(caught.code).toBe(CoreErrorCodes.ENGINE_DISPOSED);
  expect(caught.message.split("\n")[0]).toBe(DISPOSED_LINE);
}

describe("stop() teardown order", () => {
  it("plugin teardown can still call the bridge during stop(), and the bridge is disposed after", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    try {
      let during: number | string = "missing";
      await engine.use({
        name: "probe",
        setup() {},
        teardown() {
          try {
            during = engine.inject("wasm:bridge").countEntities();
          } catch (error: unknown) {
            during = error instanceof GwenError ? error.code : "throw";
          }
        },
      });
      await engine.stop();
      expect(typeof during).toBe("number");
      let caught: unknown;
      try {
        engine.inject("wasm:bridge").countEntities();
      } catch (error: unknown) {
        caught = error;
      }
      expectDisposed(caught);
    } finally {
      await engine.stop();
    }
  });

  it("disposables run before the bridge is disposed", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    try {
      let during: number | string = "missing";
      engine.disposables.add(
        "probe",
        createDisposable(() => {
          try {
            during = engine.inject("wasm:bridge").countEntities();
          } catch (error: unknown) {
            during = error instanceof GwenError ? error.code : "throw";
          }
        }),
      );
      await engine.stop();
      expect(typeof during).toBe("number");
      let caught: unknown;
      try {
        engine.inject("wasm:bridge").countEntities();
      } catch (error: unknown) {
        caught = error;
      }
      expectDisposed(caught);
    } finally {
      await engine.stop();
    }
  });
});
