import { describe, it, expect, afterEach, vi } from "vitest";
import { createEngine } from "../../src";
import { defineSystem, onUpdate } from "@gwenjs/core/system";
import { activateTestWasm } from "../helpers/activate-test-wasm";

/**
 * Stubs requestAnimationFrame so start() can be driven manually.
 * Returns a `tick(nowMs)` function that fires the next scheduled frame.
 */
function frameOf(engine: object): {
  alpha: number | undefined;
  steps: number | undefined;
  rendering: boolean | undefined;
  fixedStep: boolean | undefined;
  transforms2D: unknown;
} {
  const empty = {
    alpha: undefined,
    steps: undefined,
    rendering: undefined,
    fixedStep: undefined,
    transforms2D: undefined,
  };
  if (!("frame" in engine)) return empty;
  const frame = engine.frame;
  if (typeof frame !== "object" || frame === null) return empty;
  return {
    alpha: "alpha" in frame && typeof frame.alpha === "number" ? frame.alpha : undefined,
    steps: "steps" in frame && typeof frame.steps === "number" ? frame.steps : undefined,
    rendering:
      "rendering" in frame && typeof frame.rendering === "boolean" ? frame.rendering : undefined,
    fixedStep:
      "fixedStep" in frame && typeof frame.fixedStep === "boolean" ? frame.fixedStep : undefined,
    transforms2D: "transforms2D" in frame ? frame.transforms2D : undefined,
  };
}

function setupFixedLoopHarness() {
  let nowMs = 0;
  const pendingFrames: Array<(now: number) => void> = [];

  vi.stubGlobal("performance", { now: () => nowMs });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: (now: number) => void) => {
      pendingFrames.push(cb);
      return pendingFrames.length;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  return {
    setNow(ms: number) {
      nowMs = ms;
    },
    async tick(nowMs: number) {
      const cb = pendingFrames.shift();
      if (cb) await cb(nowMs);
    },
    pending() {
      return pendingFrames.length;
    },
  };
}

describe("fixed-timestep loop (physicsHz)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delivers fixedDt = 1/physicsHz to onUpdate each step", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60 });
    const dts: number[] = [];

    await engine.use(
      defineSystem(function fixedDtSystem() {
        onUpdate((dt) => dts.push(dt));
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start(); // _lastFrameTime = 0

    // Advance exactly one fixed step
    await harness.tick(1000 / 60); // rawDt = 16.67ms → accumulator = 1/60s → 1 step

    expect(dts.length).toBe(1);
    expect(dts[0]).toBeCloseTo(1 / 60);

    await engine.stop();
  });

  it("fires two steps when rawDt = 2 × fixedDt", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60, maxCatchupSteps: 10 });
    const dts: number[] = [];

    await engine.use(
      defineSystem(function twoStepSystem() {
        onUpdate((dt) => dts.push(dt));
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    await harness.tick((1000 / 60) * 2); // rawDt = 2 frames

    expect(dts.length).toBe(2);
    expect(dts[0]).toBeCloseTo(1 / 60);
    expect(dts[1]).toBeCloseTo(1 / 60);

    await engine.stop();
  });

  it("caps catchup at maxCatchupSteps to prevent spiral-of-death", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60, maxCatchupSteps: 2 });
    const dts: number[] = [];

    await engine.use(
      defineSystem(function catchupSystem() {
        onUpdate((dt) => dts.push(dt));
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    // 10 frames worth of time — should only produce 2 steps
    await harness.tick((1000 / 60) * 10);

    expect(dts.length).toBe(2);

    await engine.stop();
  });

  it("applies timeScale to fixedDt", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60 });
    const dts: number[] = [];

    await engine.use(
      defineSystem(function scaledFixedSystem() {
        onUpdate((dt) => dts.push(dt));
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    engine.timeScale = 0.5;
    await harness.tick(1000 / 60);

    expect(dts.length).toBe(1);
    expect(dts[0]).toBeCloseTo((1 / 60) * 0.5);

    await engine.stop();
  });

  it("accumulates residual sub-step time across frames", async () => {
    const harness = setupFixedLoopHarness();
    // 30 Hz fixed — step every 33.33ms
    const engine = await createEngine({ physicsHz: 30, maxCatchupSteps: 10 });
    const dts: number[] = [];

    await engine.use(
      defineSystem(function residualSystem() {
        onUpdate((dt) => dts.push(dt));
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    // Frame 1: 20ms — not enough for one 33.33ms step → 0 steps
    await harness.tick(20);
    expect(dts.length).toBe(0);

    // Frame 2: another 20ms → total 40ms → 1 step (residual 6.67ms carried)
    await harness.tick(40);
    expect(dts.length).toBe(1);
    expect(dts[0]).toBeCloseTo(1 / 30);

    await engine.stop();
  });

  it("schedules next frame after each tick (loop continues)", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60 });

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    expect(harness.pending()).toBe(1); // initial frame scheduled

    await harness.tick(1000 / 60);
    expect(harness.pending()).toBe(1); // next frame re-scheduled

    await engine.stop();
  });

  it("renders once on a display frame with 0, 1, and 2 fixed steps", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60, maxCatchupSteps: 10 });
    const renders: number[] = [];
    let steps = 0;
    let renderingDuring: boolean | undefined;

    engine.hooks.hook("engine:render", (alpha?: number) => {
      renders.push(alpha ?? Number.NaN);
      renderingDuring = frameOf(engine).rendering;
    });
    await engine.use(
      defineSystem(function renderCountSystem() {
        onUpdate(() => {
          steps += 1;
        });
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    await harness.tick(10);
    expect(steps).toBe(0);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toBeCloseTo(0.6, 5);
    expect(renderingDuring).toBe(true);
    expect(frameOf(engine).rendering).toBe(false);
    expect(frameOf(engine).steps).toBe(0);
    expect(frameOf(engine).transforms2D).toBe(null);

    await harness.tick(10 + 1000 / 60);
    expect(steps).toBe(1);
    expect(renders).toHaveLength(2);
    expect(renders[1]).toBeCloseTo(0.6, 5);
    expect(frameOf(engine).steps).toBe(1);

    await harness.tick(10 + 1000 / 60 + (1000 / 60) * 2);
    expect(steps).toBe(3);
    expect(renders).toHaveLength(3);
    expect(renders[2]).toBeCloseTo(0.6, 5);
    expect(frameOf(engine).steps).toBe(2);

    await engine.stop();
  });

  it("drops whole steps past the cap so the next fixedDt runs one step", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60, maxCatchupSteps: 2 });
    let steps = 0;

    await engine.use(
      defineSystem(function dropSystem() {
        onUpdate(() => {
          steps += 1;
        });
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();

    await harness.tick((1000 / 60) * 10);
    expect(steps).toBe(2);

    steps = 0;
    await harness.tick((1000 / 60) * 11);
    expect(steps).toBe(1);
    expect(frameOf(engine).alpha).toBe(0);

    await engine.stop();
  });

  it("keeps alpha independent of timeScale", async () => {
    const harness = setupFixedLoopHarness();
    const paused = await createEngine({ physicsHz: 60, maxCatchupSteps: 4 });
    const normal = await createEngine({ physicsHz: 60, maxCatchupSteps: 4 });
    const pausedAlpha: number[] = [];
    const normalAlpha: number[] = [];
    const pausedDt: number[] = [];

    paused.hooks.hook("engine:render", (alpha?: number) => {
      pausedAlpha.push(alpha ?? Number.NaN);
    });
    normal.hooks.hook("engine:render", (alpha?: number) => {
      normalAlpha.push(alpha ?? Number.NaN);
    });
    await paused.use(
      defineSystem(function pausedScaleSystem() {
        onUpdate((dt) => pausedDt.push(dt));
      })(),
    );

    harness.setNow(0);
    activateTestWasm(paused);
    activateTestWasm(normal);
    await paused.start();
    await normal.start();
    paused.timeScale = 0;

    await harness.tick(1000 / 120);
    await harness.tick(1000 / 120);
    expect(pausedAlpha).toHaveLength(1);
    expect(normalAlpha).toHaveLength(1);
    expect(pausedAlpha[0]).toBeCloseTo(0.5, 5);
    expect(normalAlpha[0]).toBeCloseTo(pausedAlpha[0], 5);
    expect(pausedDt).toEqual([]);

    await harness.tick(1000 / 120 + 1000 / 60);
    await harness.tick(1000 / 120 + 1000 / 60);
    expect(pausedDt).toHaveLength(1);
    expect(pausedDt[0]).toBe(0);
    expect(pausedAlpha[1]).toBeCloseTo(0.5, 5);
    expect(normalAlpha[1]).toBeCloseTo(pausedAlpha[1], 5);

    await paused.stop();
    await normal.stop();
  });

  it("advance accumulates fixed steps and renders once", async () => {
    const engine = await createEngine({ physicsHz: 60, maxCatchupSteps: 4 });
    const renders: number[] = [];
    let steps = 0;

    engine.hooks.hook("engine:render", (alpha?: number) => {
      renders.push(alpha ?? Number.NaN);
    });
    await engine.use(
      defineSystem(function advanceFixedSystem() {
        onUpdate(() => {
          steps += 1;
        });
      })(),
    );

    activateTestWasm(engine);
    await engine.startExternal();
    await engine.advance(2 / 60);

    expect(engine.frameCount).toBe(2);
    expect(steps).toBe(2);
    expect(renders).toHaveLength(1);
    expect(renders[0]).toBe(0);
    expect(frameOf(engine).fixedStep).toBe(true);
    expect(frameOf(engine).transforms2D).toBe(null);

    await engine.stop();
  });

  it("passes alpha 1 when physicsHz is 0", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 0 });
    const renders: number[] = [];
    let steps = 0;

    engine.hooks.hook("engine:render", (alpha?: number) => {
      renders.push(alpha ?? Number.NaN);
    });
    await engine.use(
      defineSystem(function variableAlphaSystem() {
        onUpdate(() => {
          steps += 1;
        });
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();
    await harness.tick(1000 / 60);

    expect(steps).toBe(1);
    expect(renders).toEqual([1]);
    expect(frameOf(engine).steps).toBe(1);
    expect(frameOf(engine).fixedStep).toBe(false);
    expect(frameOf(engine).transforms2D).toBe(null);

    await engine.stop();
  });

  it("stop() prevents further steps from being dispatched", async () => {
    const harness = setupFixedLoopHarness();
    const engine = await createEngine({ physicsHz: 60 });
    let stepCount = 0;

    await engine.use(
      defineSystem(function stopSystem() {
        onUpdate(() => stepCount++);
      })(),
    );

    harness.setNow(0);
    activateTestWasm(engine);
    await engine.start();
    await engine.stop();

    // Simulate a stale callback firing after stop (zombie frame)
    await harness.tick(1000 / 60);

    expect(stepCount).toBe(0);
  });
});
