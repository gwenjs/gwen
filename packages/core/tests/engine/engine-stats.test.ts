/**
 * EngineStatsRecorder without an engine.
 * Each test reads fps, frame count, delta, entity count, memory, or a phase copy.
 */

import { describe, expect, it } from "vitest";
import type { EngineFramePhaseMs } from "../../src/engine/engine-types";
import { EngineStatsRecorder } from "../../src/engine/engine-stats";

function phase(total: number): EngineFramePhaseMs {
  return {
    tick: 0,
    plugins: 0,
    wasm: 0,
    update: 0,
    render: 0,
    afterTick: 0,
    total,
  };
}

function deps(
  patch: {
    targetFPS?: number;
    debug?: boolean;
    entityCount?: () => number;
    linearMemory?: () => WebAssembly.Memory | null;
    phaseMs?: () => EngineFramePhaseMs | undefined;
  } = {},
) {
  return {
    targetFPS: patch.targetFPS ?? 60,
    debug: patch.debug ?? false,
    entityCount: patch.entityCount ?? (() => 0),
    linearMemory: patch.linearMemory ?? (() => null),
    phaseMs: patch.phaseMs ?? (() => undefined),
  };
}

describe("EngineStatsRecorder", () => {
  it("constructs without createEngine and a fresh snapshot is zero", () => {
    const recorder = new EngineStatsRecorder(deps());
    const stats = recorder.snapshot();

    expect(stats.frameCount).toBe(0);
    expect(stats.fps).toBe(0);
    expect(stats.rawFrameTime).toBe(0);
    expect(stats.deltaTime).toBe(0);
    expect(stats.entityCount).toBe(0);
    expect(stats.budgetMs).toBe(1000 / 60);
    expect("wasmMemoryBytes" in stats).toBe(false);
    expect("phaseMs" in stats).toBe(false);
    expect("overBudget" in stats).toBe(false);

    const slower = new EngineStatsRecorder(deps({ targetFPS: 30 }));
    expect(slower.snapshot().budgetMs).toBe(1000 / 30);
  });

  it("constructs without createEngine and the first positive sample is the exact fps", () => {
    const recorder = new EngineStatsRecorder(deps());

    recorder.recordRawFrameTime(1 / 60);

    expect(recorder.fps).toBeCloseTo(60, 10);
    expect(recorder.rawFrameTime).toBe(1 / 60);
    expect(recorder.snapshot().fps).toBe(recorder.fps);
  });

  it("constructs without createEngine and a non-positive sample keeps the previous fps", () => {
    const recorder = new EngineStatsRecorder(deps());
    recorder.recordRawFrameTime(1 / 60);

    recorder.recordRawFrameTime(0);
    expect(recorder.rawFrameTime).toBe(0);
    expect(recorder.fps).toBeCloseTo(60, 10);

    recorder.recordRawFrameTime(-1);
    expect(recorder.rawFrameTime).toBe(-1);
    expect(recorder.fps).toBeCloseTo(60, 10);
  });

  it("constructs without createEngine and the second sample follows the half-second ema", () => {
    const recorder = new EngineStatsRecorder(deps());
    recorder.recordRawFrameTime(1 / 60);

    recorder.recordRawFrameTime(1 / 30);

    expect(recorder.fps).toBeCloseTo(58.06520955094854, 5);
    expect(recorder.fps).toBeGreaterThan(30);
    expect(recorder.fps).toBeLessThan(60);
    expect(recorder.snapshot().fps).toBe(recorder.fps);
    expect(recorder.rawFrameTime).toBe(1 / 30);
  });

  it("constructs without createEngine and frameCompleted counts only that recorder", () => {
    const first = new EngineStatsRecorder(deps());
    const second = new EngineStatsRecorder(deps());
    expect(first.frameCount).toBe(0);

    first.frameCompleted();
    first.frameCompleted();
    second.frameCompleted();

    expect(first.frameCount).toBe(2);
    expect(second.frameCount).toBe(1);
    expect(first.snapshot().frameCount).toBe(2);
    expect(second.snapshot().frameCount).toBe(1);
  });

  it("constructs without createEngine and setDeltaTime is what snapshot returns", () => {
    const recorder = new EngineStatsRecorder(deps());
    expect(recorder.deltaTime).toBe(0);

    recorder.setDeltaTime(1 / 60);

    expect(recorder.deltaTime).toBe(1 / 60);
    expect(recorder.snapshot().deltaTime).toBe(1 / 60);

    recorder.setDeltaTime(0);
    expect(recorder.snapshot().deltaTime).toBe(0);
  });

  it("constructs without createEngine and entityCount is read when snapshot runs", () => {
    let count = 0;
    const recorder = new EngineStatsRecorder(deps({ entityCount: () => count }));

    expect(recorder.snapshot().entityCount).toBe(0);
    count = 4;
    expect(recorder.snapshot().entityCount).toBe(4);
  });

  it("constructs without createEngine and wasm bytes come from the memory or stay omitted", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const withMemory = new EngineStatsRecorder(deps({ linearMemory: () => memory }));
    const without = new EngineStatsRecorder(deps({ linearMemory: () => null }));

    expect(withMemory.snapshot().wasmMemoryBytes).toBe(memory.buffer.byteLength);
    expect("wasmMemoryBytes" in without.snapshot()).toBe(false);
  });

  it("constructs without createEngine and phase timings appear only for a debug dev build", () => {
    const quiet = phase(100);
    const hidden = new EngineStatsRecorder(deps({ debug: false, phaseMs: () => quiet }));
    const hiddenStats = hidden.snapshot();
    expect("phaseMs" in hiddenStats).toBe(false);
    expect("overBudget" in hiddenStats).toBe(false);

    const live = phase(100);
    const shown = new EngineStatsRecorder(deps({ debug: true, phaseMs: () => live }));
    const first = shown.snapshot();
    if (__GWEN_DEV__) {
      expect(first.phaseMs?.total).toBe(100);
      expect(first.overBudget).toBe(true);
      live.total = 1;
      expect(first.phaseMs?.total).toBe(100);
      const second = shown.snapshot();
      expect(second.phaseMs?.total).toBe(1);
      expect(second.overBudget).toBe(false);
    } else {
      expect("phaseMs" in first).toBe(false);
      expect("overBudget" in first).toBe(false);
    }
  });
});
