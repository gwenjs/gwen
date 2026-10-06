import { describe, expect, it } from "vitest";

import { createEngine } from "../src/index.js";
import { GwenError } from "@gwenjs/schema";

describe("start before WASM initialisation", () => {
  it("throws once and does not schedule a frame", async () => {
    const engine = await createEngine();
    let scheduled = 0;
    const previousTimeout = globalThis.setTimeout;
    const previousRaf = globalThis.requestAnimationFrame;
    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 0) scheduled += 1;
      return previousTimeout(handler, timeout, ...args);
    }) as typeof setTimeout;
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      scheduled += 1;
      return previousRaf === undefined ? 1 : previousRaf(callback);
    }) as typeof requestAnimationFrame;

    try {
      await expect(engine.start()).rejects.toBeInstanceOf(GwenError);
      await expect(engine.start()).rejects.toMatchObject({
        name: "GwenError",
        code: "CORE:WASM_NOT_INITIALIZED",
      });
      expect(engine.state).toBe("idle");
      expect(engine.frameCount).toBe(0);
      expect(scheduled).toBe(0);
    } finally {
      globalThis.setTimeout = previousTimeout;
      if (previousRaf === undefined) {
        delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
          .requestAnimationFrame;
      } else {
        globalThis.requestAnimationFrame = previousRaf;
      }
    }
  });
});
