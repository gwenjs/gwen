import { afterEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "../src/index.js";

describe("P0 frame defects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.fails("D3 fatal stop: a WebAssembly.RuntimeError does not queue another frame", async () => {
    const queued: Array<() => unknown> = [];
    const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
    const originalClearTimeout = globalThis.clearTimeout.bind(globalThis);
    const engine = await createEngine();

    vi.spyOn(globalThis, "setTimeout").mockImplementation((handler, timeout, ...args) => {
      if (typeof handler !== "function") {
        return originalSetTimeout(handler, timeout, ...args);
      }
      queued.push(() => handler(...args));
      const parked = originalSetTimeout(() => undefined, 86_400_000);
      originalClearTimeout(parked);
      return parked;
    });
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => undefined);

    try {
      engine.hooks.hook("engine:before-update", () => {
        throw new WebAssembly.RuntimeError("unreachable");
      });
      await engine.start();
      expect(queued).toHaveLength(1);
      const runFrame = queued.shift();
      if (runFrame === undefined) {
        throw new Error("start() did not queue a frame");
      }
      const result: unknown = runFrame();
      if (result instanceof Promise) {
        await result;
      }
      expect(queued).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
      await engine.stop();
    }
  });

  it.fails("D14 FPS: getFPS reports the real frame rate, not the scaled dt", async () => {
    const engine = await createEngine({ maxDeltaSeconds: 1 });
    engine.timeScale = 0.5;
    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(engine.getFPS()).toBeCloseTo(60, 5);
  });
});
