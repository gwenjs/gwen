/**
 * @file Core re-exports the kit context errors as the same class objects (P-76-5).
 */

import { afterEach, describe, expect, it } from "vitest";
import { CoreErrorCodes, createEngine, useEngine } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import * as core from "@gwenjs/core";
import * as kit from "@gwenjs/kit";

const engines: { stop: () => Promise<void> }[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

describe("core re-exports kit context errors", () => {
  it("core re-exports kit's GwenContextError class", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    expect(core.GwenContextError).toBe(kit.GwenContextError);
  });

  it("core re-exports kit's GwenComposableError class", () => {
    expect(typeof kit.GwenComposableError).toBe("function");
    expect(core.GwenComposableError).toBe(kit.GwenComposableError);
  });

  it("CoreErrorCodes.OUTSIDE_ENGINE_CONTEXT is kit's string", () => {
    expect(typeof kit.GwenContextErrorCodes).toBe("object");
    expect(CoreErrorCodes.OUTSIDE_ENGINE_CONTEXT).toBe(
      kit.GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT,
    );
    expect(CoreErrorCodes.OUTSIDE_ENGINE_CONTEXT).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
  });

  it("useEngine outside a context throws kit's GwenContextError", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    let thrown: unknown;
    try {
      useEngine();
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof kit.GwenContextError).toBe(true);
    if (!(thrown instanceof kit.GwenContextError)) return;
    expect(thrown.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    expect(thrown.composable).toBe("useEngine");
    expect(thrown.message.split("\n")[0]).toBe(
      "[useEngine()] Called outside defineSystem() or defineActor() or defineScene() or plugin setup() or engine.run().",
    );
    if (__GWEN_DEV__) {
      expect(thrown.message).toContain("gwen dev");
    } else {
      expect(thrown.message).not.toContain("Fix:");
    }
  });

  it("a failing plugin setup rejects with kit's GwenComposableError", async () => {
    expect(typeof kit.GwenComposableError).toBe("function");
    const engine = await createEngine({ maxEntities: 64 });
    engines.push(engine);
    const plugin = definePlugin(() => ({
      name: "boom",
      setup() {
        throw new Error("x");
      },
    }))();
    let thrown: unknown;
    try {
      await engine.use(plugin);
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof kit.GwenComposableError).toBe(true);
    if (!(thrown instanceof kit.GwenComposableError)) return;
    expect(thrown.code).toBe("engine:plugin-setup-failed");
    expect(thrown.message).toBe('Plugin "boom" setup failed: x');
  });
});
