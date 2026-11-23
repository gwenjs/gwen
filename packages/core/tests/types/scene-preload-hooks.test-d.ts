import { describe, expect, expectTypeOf, it } from "vitest";
import type { GwenEngine } from "@gwenjs/core";
import type { GwenSceneName } from "@gwenjs/schema";

declare const engine: GwenEngine;

function checkScenePreloadHooks(): void {
  engine.hooks.hook("scene:preload", (event) => {
    expectTypeOf(event.from).toEqualTypeOf<GwenSceneName | null>();
    expectTypeOf(event.to).toEqualTypeOf<GwenSceneName>();
    expectTypeOf(event.progress).toEqualTypeOf<
      (task: string, loaded: number, total: number) => void
    >();
  });
  engine.hooks.hook("scene:preload:progress", (payload) => {
    expectTypeOf(payload).toEqualTypeOf<{
      readonly from: GwenSceneName | null;
      readonly to: GwenSceneName;
      readonly progress: number;
    }>();
  });
}

void checkScenePreloadHooks;

describe("scene preload hooks", () => {
  it("typechecks scene:preload and scene:preload:progress", () => {
    expect(typeof checkScenePreloadHooks).toBe("function");
  });
});
