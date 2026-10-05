/**
 * Wall-clock gates moved out of the unit suite (D18).
 * Same operations and budgets as the former tests. Run with `vitest run --dir bench`.
 */

import { describe, expect, it } from "vitest";
import { createEngine, useEngine } from "../src/index";
import { defineSequence } from "../src/tween/runtime/define-sequence";
import { TweenPlugin } from "../src/tween/engine-plugin";
import { TweenPool } from "../src/tween/runtime/tween-pool";
import type {
  SequenceStep,
  TweenableValue,
  TweenHandle,
  TweenOptions,
} from "../src/tween/runtime/tween-types";
import { ciThreshold } from "./perf";

function claimSlot(
  pool: TweenPool,
  options: TweenOptions<TweenableValue>,
): TweenHandle<TweenableValue> {
  const slot = pool.claim(options);
  if (slot === null) {
    throw new Error("TweenPool.claim returned null");
  }
  return slot;
}

function slotAt(
  slots: readonly TweenHandle<TweenableValue>[],
  index: number,
): TweenHandle<TweenableValue> {
  const slot = slots[index];
  if (slot === undefined) {
    throw new Error(`Tween slot missing at index ${index}`);
  }
  return slot;
}

describe("createEngine", () => {
  it("initialises in < 50ms", async () => {
    const t = performance.now();
    await createEngine();
    expect(performance.now() - t).toBeLessThan(ciThreshold(50));
  });
});

describe("engine.use / engine.unuse", () => {
  it("setup overhead < 5ms for no-op plugin", async () => {
    const engine = await createEngine();
    const t = performance.now();
    await engine.use({ name: "Perf", setup() {} });
    expect(performance.now() - t).toBeLessThan(ciThreshold(5));
  });
});

describe("Performance", () => {
  it("10,000 useEngine() calls complete in < 0.5ms", async () => {
    const engine = await createEngine({ maxEntities: 100 });

    // Warm-up run to avoid JIT cold-start timing skew
    engine.run(() => {
      useEngine();
    });

    const start = performance.now();
    engine.run(() => {
      for (let i = 0; i < 10_000; i++) {
        useEngine();
      }
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(ciThreshold(0.5, 20));
  });
});

describe("Performance: 1,000 tweens ticking per frame", () => {
  it("ticks 1,000 active number tweens in < 0.5ms (warm)", () => {
    const pool = new TweenPool(1_000);
    for (let i = 0; i < 1_000; i++) {
      const slot = claimSlot(pool, { duration: 1, easing: "linear" });
      slot.play({ from: 0, to: 100 });
    }

    // Warm-up run to avoid JIT cold-start timing skew
    pool.tick(0.001);

    const start = performance.now();
    pool.tick(0.016);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(ciThreshold(0.5, 2));
  });
});

describe("Performance: 10,000 tweens ticking per frame", () => {
  it("ticks 10,000 active number tweens in < 5ms", () => {
    const pool = new TweenPool(10_000);
    for (let i = 0; i < 10_000; i++) {
      const slot = claimSlot(pool, { duration: 1, easing: "linear" });
      slot.play({ from: 0, to: 100 });
    }

    const start = performance.now();
    pool.tick(0.016);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(ciThreshold(5, 2));
  });
});

describe("Performance: defineSequence with 10 steps × 1,000 instances", () => {
  it("creates and starts 1,000 sequences with 10 tween steps each in < 2ms", async () => {
    const engine = await createEngine({ maxEntities: 100 });
    await engine.use(TweenPlugin());

    // Pre-allocate 10,100 TweenSlots from a large pool outside the engine
    // (avoids exhausting the engine's default 256-slot TweenManager pool).
    // TweenSlot implements TweenHandle, so it can be passed directly to defineSequence.
    const bigPool = new TweenPool(10_100);
    const preClaimed: TweenHandle<TweenableValue>[] = [];
    for (let i = 0; i < 10_100; i++) {
      preClaimed.push(claimSlot(bigPool, { duration: 0.1, easing: "linear" }));
    }

    // Larger warm-up to stabilize JIT before measurement
    engine.run(() => {
      for (let w = 0; w < 50; w++) {
        const seq = defineSequence([{ tween: slotAt(preClaimed, w), from: 0, to: 1 }]);
        seq.play();
      }
    });

    const start = performance.now();

    engine.run(() => {
      let idx = 50; // skip warm-up slots
      for (let s = 0; s < 1_000; s++) {
        const steps: SequenceStep[] = [];
        for (let i = 0; i < 10; i++) {
          const tween = slotAt(preClaimed, idx);
          idx += 1;
          steps.push({ tween, from: i * 10, to: (i + 1) * 10 });
        }
        defineSequence(steps).play();
      }
    });

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(ciThreshold(5, 10));
  });
});

describe("Performance: zero-alloc tick sanity", () => {
  it("100 consecutive pool.tick() calls with 1000 tweens each stay fast", () => {
    const pool = new TweenPool(1_000);
    for (let i = 0; i < 1_000; i++) {
      const slot = claimSlot(pool, { duration: 100, easing: "linear", loop: true });
      slot.play({ from: 0, to: 1 });
    }

    const start = performance.now();
    for (let frame = 0; frame < 100; frame++) {
      pool.tick(0.016);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(ciThreshold(50));
  });
});
