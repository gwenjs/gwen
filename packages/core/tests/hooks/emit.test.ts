/**
 * @file Tests for `emit()` — RFC-011 Task 8
 *
 * Verifies that `emit` is sugar over `engine.hooks.callHook` and that it
 * throws with a `[GWEN]` prefix when called outside an engine context.
 */

import { describe, it, expect, vi } from "vitest";
import { emit } from "../../src/hooks/emit";
import { createEngine } from "../../src/engine/gwen-engine";
import { engineContext } from "../../src/engine/context";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";

describe("emit()", () => {
  it("calls engine.hooks.callHook for a known hook with typed args", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    engine.hooks.hook("entity:spawn", spy as GwenRuntimeHooks["entity:spawn"]);

    engine.run(() => {
      emit("entity:spawn", 1n);
    });

    expect(spy).toHaveBeenCalledWith(1n);
  });

  it("accepts arbitrary custom event strings without casting", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    // Custom game event — no augmentation, no cast needed
    engine.hooks.hook("enemy:died" as never, spy as never);

    engine.run(() => {
      emit("enemy:died"); // no "as never" needed
      emit("player:damage", 25); // no "as never" needed
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws with [GWEN] prefix when called outside engine context", () => {
    engineContext.unset();
    expect(() => emit("engine:init")).toThrow("[GWEN]");
  });
});
