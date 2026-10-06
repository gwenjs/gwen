import { afterEach, describe, expect, it, vi } from "vitest";

import { CoreErrorCodes, GwenWasmPanicError, createEngine } from "../src/index.js";

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

  it("classifies GwenWasmPanicError as one fatal WASM_PANIC", async () => {
    const seen: Array<{ level: string; code: string; source?: string }> = [];
    const engine = await createEngine();
    engine.errors.on((event) => {
      seen.push(event);
    });
    await engine.startExternal();
    engine.hooks.hook("engine:before-update", () => {
      throw new GwenWasmPanicError(undefined, new WebAssembly.RuntimeError("unreachable"));
    });
    await engine.advance(1 / 60);

    const fatals = seen.filter(
      (event) => event.level === "fatal" && event.code === CoreErrorCodes.WASM_PANIC,
    );
    expect(fatals).toHaveLength(1);
    expect(fatals[0]?.source).toBe("gwen_core.wasm");
    expect(engine.state).toBe("faulted");
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

  it.runIf(!__GWEN_DEV__)("prod + debug: true does not time the frame", async () => {
    const engine = await createEngine({
      debug: true,
      // Skip the uninitialized WASM bridge so the error logger does not call performance.now().
      // checkMemoryGrow is called on every phase. A missing method throws and the logger times it.
      _bridge: { engine: () => ({}), checkMemoryGrow: () => false } as never,
    });
    await engine.startExternal();
    const now = vi.spyOn(performance, "now");
    try {
      await engine.advance(1 / 60);
      expect(now).not.toHaveBeenCalled();
      const stats = engine.getStats();
      expect("phaseMs" in stats).toBe(false);
      expect("overBudget" in stats).toBe(false);
    } finally {
      now.mockRestore();
      await engine.stop();
    }
  });

  it.runIf(__GWEN_DEV__)("dev + debug: true reports the 8 phase fields", async () => {
    const engine = await createEngine({ debug: true });
    await engine.startExternal();
    try {
      await engine.advance(1 / 60);
      const stats = engine.getStats();
      expect(Object.keys(stats.phaseMs ?? {}).sort()).toEqual([
        "afterTick",
        "physics",
        "plugins",
        "render",
        "tick",
        "total",
        "update",
        "wasm",
      ]);
      expect(typeof stats.overBudget).toBe("boolean");
    } finally {
      await engine.stop();
    }
  });
});
