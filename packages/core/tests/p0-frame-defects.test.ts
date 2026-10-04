import { afterEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "../src/index.js";

describe("P0 frame defects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("D3 fatal stop: a WebAssembly.RuntimeError does not queue another frame", async () => {
    const queued: Array<() => unknown> = [];
    const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
    const originalClearTimeout = globalThis.clearTimeout.bind(globalThis);
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
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
      clock = 20;
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

  it("D14 FPS: getFPS reports the real frame rate, not the scaled dt", async () => {
    const engine = await createEngine({ maxDeltaSeconds: 1 });
    engine.timeScale = 0.5;
    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(engine.getFPS()).toBeCloseTo(60, 5);
  });

  it("D14 FPS: a longer second frame moves getFPS toward 30 without snapping", async () => {
    const engine = await createEngine({ maxDeltaSeconds: 1 });
    engine.timeScale = 0.5;
    await engine.startExternal();
    await engine.advance(1 / 60);
    expect(engine.getFPS()).toBeCloseTo(60, 5);

    const rawSeconds = 1 / 30;
    await engine.advance(rawSeconds);
    const sample = 1 / rawSeconds;
    const alpha = 1 - Math.exp(-rawSeconds / 0.5);
    const expected = alpha * sample + (1 - alpha) * 60;
    const fps = engine.getFPS();
    expect(fps).toBeCloseTo(expected, 5);
    expect(fps).toBeGreaterThan(30);
    expect(fps).toBeLessThan(60);
    expect(engine.getStats().fps).toBe(fps);
    expect(engine.rawFrameTime).toBe(rawSeconds);
    expect(engine.deltaTime).toBeCloseTo(rawSeconds * 0.5, 5);
  });
});
