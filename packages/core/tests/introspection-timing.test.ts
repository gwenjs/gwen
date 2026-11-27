/**
 * @file Dev introspection timing: per-system `frameMs` behind the single instrument gate.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GwenIntrospection, GwenIntrospectionSystem } from "@gwenjs/schema";
import {
  CoreErrorCodes,
  GwenContextError,
  useEngine,
  type GwenEngine,
  type GwenEngineOptions,
} from "../src/index.js";
import { createEngine } from "../src/node.js";
import { whenFrameIdle } from "../src/engine/engine-internals.js";
import { hotReplaceSystem } from "../src/internal.js";
import { defineActor, definePrefab, useActor } from "../src/actor/index.js";
import { useHook } from "../src/hooks/index.js";
import { createSystemHandle } from "../src/scene/runtime/system-handle.js";
import { ScopedHookable } from "../src/hooks/scoped-hookable.js";
import { beginPass, frameMeterOf, timingFor } from "../src/introspection/timing-store.js";
import {
  defineSystem,
  onAfterUpdate,
  onBeforeUpdate,
  onRender,
  onUpdate,
} from "../src/system/index.js";
import "./support/plugin-registry";

const engines: GwenEngine[] = [];

/** Fake clock: `performance.now()` returns `clock.now`; a handler moves it by `clock.now += cost`. */
const clock = { now: 100, calls: 0 };

function useFakeClock(): void {
  clock.now = 100;
  clock.calls = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    clock.calls += 1;
    return clock.now;
  });
}

async function open(options?: GwenEngineOptions): Promise<GwenEngine> {
  const engine = await createEngine(options);
  engines.push(engine);
  await engine.startExternal();
  return engine;
}

function introOf(engine: GwenEngine): GwenIntrospection {
  const intro = engine.tryInject("introspection");
  if (intro === undefined) throw new Error("the dev engine has no introspection service");
  return intro;
}

function rowOf(intro: GwenIntrospection, name: string): GwenIntrospectionSystem | undefined {
  return intro.snapshot().systems.find((row) => row.name === name);
}

const FRAME = 1 / 60;

afterEach(async () => {
  vi.restoreAllMocks();
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

describe.runIf(__GWEN_DEV__)("introspection timing", () => {
  it("dev with debug true gives frameMs with 5 numeric fields and lastRunFrame", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onBeforeUpdate(() => void (clock.now += 1));
      onUpdate(() => void (clock.now += 2));
      onAfterUpdate(() => void (clock.now += 3));
      onRender(() => void (clock.now += 4));
    });
    const engine = await open({ debug: true });
    await engine.use(probe());
    const intro = introOf(engine);
    expect(intro.snapshot().timing).toBe(true);
    expect(rowOf(intro, "probe")?.frameMs).toBeUndefined();
    await engine.advance(FRAME);
    const row = rowOf(intro, "probe");
    expect(row?.frameMs).toEqual({
      beforeUpdate: 1,
      update: 2,
      afterUpdate: 3,
      render: 4,
      total: 10,
    });
    expect(row?.lastRunFrame).toBe(intro.snapshot().frameCount);
  });

  it("dev with debug false adds no performance.now call per system handler", async () => {
    useFakeClock();
    const handlers = () => {
      onBeforeUpdate(() => {});
      onUpdate(() => {});
      onAfterUpdate(() => {});
      onRender(() => {});
    };
    const callsFor = async (debug: boolean, systems: number): Promise<number> => {
      const engine = await open({ debug });
      for (let i = 0; i < systems; i++) await engine.use(defineSystem(`probe${i}`, handlers)());
      await engine.advance(FRAME);
      clock.calls = 0;
      await engine.advance(FRAME);
      return clock.calls;
    };
    const idleOff = await callsFor(false, 0);
    const busyOff = await callsFor(false, 3);
    const idleOn = await callsFor(true, 0);
    const busyOn = await callsFor(true, 3);
    expect([busyOff - idleOff, busyOn - idleOn]).toEqual([0, 24]);
  });

  it("debug false gives no frameMs and no lastRunFrame", async () => {
    const probe = defineSystem("probe", () => {
      onUpdate(() => {});
    });
    const engine = await open({ debug: true });
    const quiet = await open({ debug: false });
    await engine.use(probe());
    await quiet.use(probe());
    await engine.advance(FRAME);
    await quiet.advance(FRAME);
    expect(rowOf(introOf(engine), "probe")?.frameMs).toBeDefined();
    expect(rowOf(introOf(quiet), "probe")).toBeDefined();
    expect(rowOf(introOf(quiet), "probe")?.frameMs).toBeUndefined();
    expect(rowOf(introOf(quiet), "probe")?.lastRunFrame).toBeUndefined();
    expect(introOf(quiet).snapshot().timing).toBe(false);
  });

  it("a throwing handler still records its time", async () => {
    useFakeClock();
    const boom = defineSystem("boom", () => {
      onUpdate(() => {
        clock.now += 5;
        throw new Error("boom");
      });
    });
    const engine = await open({ debug: true });
    await engine.use(boom());
    await engine.advance(FRAME);
    const row = rowOf(introOf(engine), "boom");
    expect(row?.isolated).toBe(true);
    expect(row?.frameMs?.update).toBe(5);
  });

  it("a handler that throws through the scope wrapper still records its time and rethrows", async () => {
    // The public composables wrap every handler in a guard that swallows the throw below the
    // wrapper, so only a bare scope reaches the `finally` of the timed call.
    useFakeClock();
    const engine = await open({ debug: true });
    const scope = new ScopedHookable(engine.hooks);
    const timing = timingFor(engine, "system#raw");
    scope._timing = timing;
    scope.hook("engine:update", () => {
      clock.now += 5;
      throw new Error("raw boom");
    });
    beginPass(engine, 1, true, () => clock.now);
    try {
      await expect(engine.hooks.callHook("engine:update", FRAME)).rejects.toThrow("raw boom");
    } finally {
      scope.dispose();
    }
    expect(timing.update).toBe(5);
    expect(timing.frame).toBe(1);
  });

  it("a paused system does not accumulate", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 2));
    });
    const wrapped = createSystemHandle(probe());
    const engine = await open({ debug: true });
    await engine.use(wrapped.plugin);
    const intro = introOf(engine);
    await engine.advance(FRAME);
    const before = rowOf(intro, "probe");
    expect(before?.frameMs?.update).toBe(2);
    wrapped.handle.pause();
    await engine.advance(FRAME);
    await engine.advance(FRAME);
    const paused = rowOf(intro, "probe");
    expect(paused?.paused).toBe(true);
    expect(paused?.frameMs).toEqual(before?.frameMs);
    expect(paused?.lastRunFrame).toBe(before?.lastRunFrame);
    wrapped.handle.resume();
    await engine.advance(FRAME);
    expect(rowOf(intro, "probe")?.lastRunFrame).toBe(intro.snapshot().frameCount);
  });

  it("a swapped system keeps its timing record id", async () => {
    useFakeClock();
    const make = (cost: number) =>
      defineSystem("swapme", () => {
        onUpdate(() => void (clock.now += cost));
      });
    const first = make(2);
    const engine = await open({ debug: true });
    await engine.use(first());
    const intro = introOf(engine);
    await engine.advance(FRAME);
    const before = rowOf(intro, "swapme");
    expect(before?.frameMs?.update).toBe(2);
    await hotReplaceSystem(first, make(7));
    await engine.advance(FRAME);
    const after = intro.snapshot().systems.filter((row) => row.name === "swapme");
    expect(after.map((row) => row.id)).toEqual([before?.id]);
    expect(after[0]?.frameMs?.update).toBe(7);
  });

  it("two handlers of one phase add up inside one frame", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 2));
      onUpdate(() => void (clock.now += 3));
    });
    const engine = await open({ debug: true });
    await engine.use(probe());
    await engine.advance(FRAME);
    expect(rowOf(introOf(engine), "probe")?.frameMs).toEqual({
      beforeUpdate: 0,
      update: 5,
      afterUpdate: 0,
      render: 0,
      total: 5,
    });
  });

  it("a new frame replaces the values of the previous one", async () => {
    useFakeClock();
    let cost = 2;
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += cost));
    });
    const engine = await open({ debug: true });
    await engine.use(probe());
    const intro = introOf(engine);
    await engine.advance(FRAME);
    const first = rowOf(intro, "probe");
    cost = 9;
    await engine.advance(FRAME);
    const second = rowOf(intro, "probe");
    expect(first?.frameMs?.update).toBe(2);
    expect(second?.frameMs?.update).toBe(9);
    expect(second?.lastRunFrame).toBe((first?.lastRunFrame ?? 0) + 1);
  });

  it("a system installed after the last frame has no frameMs and no lastRunFrame", async () => {
    const early = defineSystem("early", () => {
      onUpdate(() => {});
    });
    const late = defineSystem("late", () => {
      onUpdate(() => {});
    });
    const engine = await open({ debug: true });
    await engine.use(early());
    await engine.advance(FRAME);
    await engine.use(late());
    const intro = introOf(engine);
    expect(rowOf(intro, "early")?.frameMs).toBeDefined();
    const row = rowOf(intro, "late");
    expect(row).toBeDefined();
    expect("frameMs" in (row ?? {})).toBe(false);
    expect("lastRunFrame" in (row ?? {})).toBe(false);
  });

  it("actor handlers are not timed and give no system row", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 1));
    });
    const Hero = defineActor("p94-timing-hero", definePrefab([]), () => {
      onUpdate(() => void (clock.now += 4));
      return {};
    });
    const callsPerFrame = async (engine: GwenEngine): Promise<number> => {
      await engine.advance(FRAME);
      clock.calls = 0;
      await engine.advance(FRAME);
      return clock.calls;
    };
    const plain = await open({ debug: true });
    await plain.use(probe());
    const baseline = await callsPerFrame(plain);
    const engine = await open({ debug: true });
    await engine.use(probe());
    await engine.use(Hero.plugin);
    engine.run(() => useActor(Hero)).spawn();
    const withActor = await callsPerFrame(engine);
    const intro = introOf(engine);
    expect(rowOf(intro, "probe")?.frameMs?.update).toBe(1);
    expect(withActor - baseline).toBe(0);
    expect(intro.snapshot().systems.map((row) => row.name)).not.toContain("p94-timing-hero");
  });

  it("frameMs and its row are frozen and replaced by a new object each read", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 1));
    });
    const engine = await open({ debug: true });
    await engine.use(probe());
    const intro = introOf(engine);
    await engine.advance(FRAME);
    const first = rowOf(intro, "probe");
    await engine.advance(FRAME);
    const second = rowOf(intro, "probe");
    expect(first?.frameMs?.update).toBe(1);
    expect(first?.frameMs).not.toBe(second?.frameMs);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.frameMs)).toBe(true);
  });

  it("two engines keep their own timing records", async () => {
    useFakeClock();
    const make = (cost: number) =>
      defineSystem("probe", () => {
        onUpdate(() => void (clock.now += cost));
      });
    const left = await open({ debug: true });
    const right = await open({ debug: true });
    await left.use(make(2)());
    await right.use(make(6)());
    await left.advance(FRAME);
    expect(rowOf(introOf(left), "probe")?.frameMs?.update).toBe(2);
    expect(rowOf(introOf(right), "probe")?.frameMs).toBeUndefined();
    await right.advance(FRAME);
    expect(rowOf(introOf(right), "probe")?.frameMs?.update).toBe(6);
    expect(rowOf(introOf(left), "probe")?.frameMs?.update).toBe(2);
    expect(frameMeterOf(left)).not.toBe(frameMeterOf(right));
    expect(timingFor(left, "system#shared")).not.toBe(timingFor(right, "system#shared"));
  });

  it("with physicsHz 60 the render handlers are timed in the record of the frame", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 2));
      onRender(() => void (clock.now += 4));
    });
    const engine = await open({ debug: true, physicsHz: 60 });
    await engine.use(probe());
    await engine.advance(FRAME);
    const row = rowOf(introOf(engine), "probe");
    expect(row?.frameMs?.render).toBe(4);
    expect(row?.frameMs?.update).toBe(2);
  });

  it("with physicsHz 60 a display frame without a step starts a record of its own", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 2));
      onRender(() => void (clock.now += 4));
    });
    const engine = await open({ debug: true, physicsHz: 60 });
    await engine.use(probe());
    const intro = introOf(engine);
    await engine.advance(FRAME);
    const stepped = rowOf(intro, "probe");
    expect(stepped?.frameMs).toEqual({
      beforeUpdate: 0,
      update: 2,
      afterUpdate: 0,
      render: 4,
      total: 6,
    });
    await engine.advance(0.001);
    const idle = rowOf(intro, "probe");
    expect(idle?.frameMs).toEqual({
      beforeUpdate: 0,
      update: 0,
      afterUpdate: 0,
      render: 4,
      total: 4,
    });
    expect(idle?.lastRunFrame).toBe(intro.snapshot().frameCount);
  });

  it("stop during an awaited frame restores the engine context", async () => {
    useFakeClock();
    const probe = defineSystem("probe", () => {
      onUpdate(() => void (clock.now += 1));
    });
    const timed = await open({ debug: true });
    await timed.use(probe());
    await timed.advance(FRAME);
    expect(rowOf(introOf(timed), "probe")?.frameMs?.update).toBe(1);

    // The gate holds `engine:afterTick` open so `stop()` runs while the frame is still current.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const quiet = await open({ debug: false });
    quiet.hooks.hook("engine:afterTick", () => gate);
    const idle = whenFrameIdle(quiet);
    const frame = quiet.advance(FRAME);
    await quiet.stop();
    if (release === undefined) throw new Error("the afterTick gate was not armed");
    release();
    await frame;
    let thrown: unknown;
    try {
      useEngine();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GwenContextError);
    if (!(thrown instanceof GwenContextError)) return;
    expect(thrown.code).toBe(CoreErrorCodes.OUTSIDE_ENGINE_CONTEXT);
    await idle;
  });

  it("a swap whose setup throws keeps the timing record id", async () => {
    useFakeClock();
    const make = (cost: number) =>
      defineSystem("swapme", () => {
        onUpdate(() => void (clock.now += cost));
      });
    const broken = defineSystem("swapme", () => {
      throw new Error("setup boom");
    });
    const first = make(2);
    const engine = await open({ debug: true });
    await engine.use(first());
    const intro = introOf(engine);
    await engine.advance(FRAME);
    const before = rowOf(intro, "swapme");
    expect(before?.frameMs?.update).toBe(2);
    await hotReplaceSystem(first, broken);
    await hotReplaceSystem(broken, make(7));
    await engine.advance(FRAME);
    const after = intro.snapshot().systems.filter((row) => row.name === "swapme");
    expect(after.map((row) => row.id)).toEqual([before?.id]);
    expect(after[0]?.frameMs?.update).toBe(7);
  });

  it("a teardown drops the timing record before the next setup", async () => {
    useFakeClock();
    const make = (cost: number) =>
      defineSystem("again", () => {
        onUpdate(() => void (clock.now += cost));
      });
    const first = make(2);
    const engine = await open({ debug: true });
    const plugin = first();
    await engine.use(plugin);
    const intro = introOf(engine);
    await engine.advance(FRAME);
    expect(rowOf(intro, "again")?.frameMs?.update).toBe(2);
    await hotReplaceSystem(first, make(9));
    await engine.unuse("again");
    await engine.use(plugin);
    const row = rowOf(intro, "again");
    expect(row).toBeDefined();
    expect(row?.frameMs).toBeUndefined();
    expect(row?.lastRunFrame).toBeUndefined();
  });

  it("a non-frame hook fired inside the frame is not timed", async () => {
    useFakeClock();
    const plain = defineSystem("plain", () => {
      onUpdate(() => void (clock.now += 1));
    });
    const hooked = defineSystem("hooked", () => {
      onUpdate(() => void (clock.now += 1));
      useHook("engine:afterTick", () => {
        clock.now += 8;
      });
    });
    const engine = await open({ debug: true });
    await engine.use(hooked());
    await engine.advance(FRAME);
    const row = rowOf(introOf(engine), "hooked");
    expect(row?.frameMs?.update).toBe(1);
    expect(row?.frameMs?.render).toBe(0);
    clock.calls = 0;
    await engine.advance(FRAME);
    const withHook = clock.calls;
    expect(rowOf(introOf(engine), "hooked")?.frameMs?.render).toBe(0);
    const other = await open({ debug: true });
    await other.use(plain());
    await other.advance(FRAME);
    clock.calls = 0;
    await other.advance(FRAME);
    expect(withHook - clock.calls).toBe(0);
  });
});
