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
import { createEntityId } from "../../src/types/entity";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "emit-test:died": () => void;
    "emit-test:damage": (amount: number) => void;
  }
}

describe("emit()", () => {
  it("calls engine.hooks.callHook for a known hook with typed args", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    engine.hooks.hook("entity:spawn", spy as GwenRuntimeHooks["entity:spawn"]);

    engine.run(() => {
      emit("entity:spawn", createEntityId(1, 0));
    });

    expect(spy).toHaveBeenCalledWith(1n);
  });

  it("accepts arbitrary custom event strings without casting", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    // Custom game event — no augmentation, no cast needed
    engine.hooks.hook("emit-test:died", spy as GwenRuntimeHooks["emit-test:died"]);

    engine.run(() => {
      emit("emit-test:died");
      emit("emit-test:damage", 25);
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws with [GWEN] prefix when called outside engine context", () => {
    engineContext.unset();
    expect(() => emit("engine:init")).toThrow("[GWEN]");
  });
});
