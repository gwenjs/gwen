import { describe, it, expect, afterEach, vi } from "vitest";
import { createEngine } from "../../src";
import { defineSystem, onUpdate } from "@gwenjs/core/system";
import { activateTestWasm } from "../helpers/activate-test-wasm";

/**
 * Stubs requestAnimationFrame so start() can be driven manually.
 * Returns a `tick(nowMs)` function that fires the next scheduled frame.
 */
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
