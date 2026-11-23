import { afterEach, describe, expect, it } from "vitest";
import type { GwenErrorPayload, ScenePreloadEvent } from "@gwenjs/schema";
import { createEngine } from "../../src/node.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { GwenScenePreloadError } from "../../src/scene/scene-preload-error.js";
import { runScenePreload } from "../../src/scene/run-scene-preload.js";

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Thrown value, or `undefined` when the promise resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (caught) {
    return caught;
  }
}

describe("runScenePreload", () => {
  const engines: GwenEngine[] = [];

  async function loadEngine(): Promise<GwenEngine> {
    const engine = await createEngine();
    engines.push(engine);
    return engine;
  }

  afterEach(async () => {
    const pending = engines.splice(0);
    for (const engine of pending) await engine.stop();
  });

  function watchProgress(engine: GwenEngine): number[] {
    const seen: number[] = [];
    engine.hooks.hook("scene:preload:progress", (payload) => {
      seen.push(payload.progress);
    });
    return seen;
  }

  function watchErrors(engine: GwenEngine): GwenErrorPayload[] {
    const bus: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      bus.push(event);
    });
    return bus;
  }

  it("the event carries from and to and handlers run in parallel", async () => {
    const engine = await loadEngine();
    const first = gate();
    const second = gate();
    const events: ScenePreloadEvent[] = [];
    const started: string[] = [];
    engine.hooks.hook("scene:preload", async (event) => {
      events.push(event);
      started.push("h1");
      await first.promise;
    });
    engine.hooks.hook("scene:preload", async (event) => {
      events.push(event);
      started.push("h2");
      await second.promise;
    });
    try {
      const run = runScenePreload(engine, "menu", "level");
      expect(started).toEqual(["h1", "h2"]);
      expect(events).toHaveLength(2);
      expect(events[0]).toBe(events[1]);
      expect(events[0]?.from).toBe("menu");
      expect(events[0]?.to).toBe("level");
      first.open();
      second.open();
      await run;
    } finally {
      first.open();
      second.open();
    }
  });

  it("progress emits 0 first and 1 last", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    engine.hooks.hook("scene:preload", (event) => {
      event.progress("a", 1, 2);
      event.progress("a", 2, 2);
    });
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 0.5, 1]);
  });

  it("progress is Σloaded/Σtotal over task keys, clamped and monotonic", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    engine.hooks.hook("scene:preload", (event) => {
      event.progress("a", 1, 2);
      event.progress("b", 0, 4);
      event.progress("a", 2, 2);
      event.progress("b", 3, 4);
      event.progress("b", 3, 4);
      event.progress("b", 1, 4);
    });
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 0.5, 5 / 6, 1]);
  });

  it("no task report emits only 0 and 1", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    engine.hooks.hook("scene:preload", () => {});
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 1]);
  });

  it("reports after settle or with total <= 0 are ignored", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    let event: ScenePreloadEvent | undefined;
    engine.hooks.hook("scene:preload", (preload) => {
      event = preload;
      preload.progress("zero", 1, 0);
      preload.progress("negative-total", 1, -1);
      preload.progress("nan-total", 1, Number.NaN);
      preload.progress("infinite-total", 1, Number.POSITIVE_INFINITY);
      preload.progress("nan-loaded", Number.NaN, 2);
      preload.progress("infinite-loaded", Number.POSITIVE_INFINITY, 2);
      preload.progress("ok", 1, 2);
    });
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 0.5, 1]);
    if (event !== undefined) event.progress("late", 1, 1);
    expect(seen).toEqual([0, 0.5, 1]);
  });

  it("a total of zero on a known task is ignored", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    engine.hooks.hook("scene:preload", (event) => {
      event.progress("a", 1, 2);
      event.progress("b", 0, 2);
      event.progress("a", 1, 0);
      event.progress("b", 2, 2);
    });
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 0.5, 0.75, 1]);
  });

  it("the first rejection becomes GwenScenePreloadError with scene, from and cause", async () => {
    const engine = await loadEngine();
    const held = gate();
    const errA = new Error("errA");
    const errB = new Error("errB");
    engine.hooks.hook("scene:preload", async () => {
      await held.promise;
      throw errA;
    });
    engine.hooks.hook("scene:preload", () => {
      throw errB;
    });
    try {
      const error = await rejectionOf(runScenePreload(engine, "menu", "level"));
      expect(error).toBeInstanceOf(GwenScenePreloadError);
      if (!(error instanceof GwenScenePreloadError)) return;
      expect(error.code).toBe("CORE:SCENE_PRELOAD_FAILED");
      expect(error.scene).toBe("level");
      expect(error.from).toBe("menu");
      expect(error.cause).toBe(errB);
    } finally {
      held.open();
    }

    const other = await loadEngine();
    other.hooks.hook("scene:preload", () => {
      throw "boom";
    });
    const boom = await rejectionOf(runScenePreload(other, "menu", "level"));
    expect(boom).toBeInstanceOf(GwenScenePreloadError);
    if (!(boom instanceof GwenScenePreloadError)) return;
    expect(boom.cause).toBe("boom");
  });

  it("no progress 1 and no engine.errors event on failure", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    const bus = watchErrors(engine);
    let event: ScenePreloadEvent | undefined;
    engine.hooks.hook("scene:preload", (preload) => {
      event = preload;
      preload.progress("a", 1, 2);
      throw new Error("preload failed");
    });
    await rejectionOf(runScenePreload(engine, "menu", "level"));
    expect(seen).toEqual([0, 0.5]);
    expect(bus).toEqual([]);
    if (event === undefined) {
      expect(event).toBeTypeOf("object");
      return;
    }
    event.progress("a", 1.5, 2);
    expect(seen).toEqual([0, 0.5]);
  });

  it("from is null on initial activation", async () => {
    const engine = await loadEngine();
    const recorded: Array<ScenePreloadEvent["from"]> = [];
    engine.hooks.hook("scene:preload", (event) => {
      recorded.push(event.from);
    });
    await runScenePreload(engine, null, "level");
    expect(recorded).toEqual([null]);
  });

  it("zero handlers resolves with 0 and 1", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 1]);
  });

  it("two engines each run their own handlers", async () => {
    const engineA = await loadEngine();
    const engineB = await loadEngine();
    const seenA = watchProgress(engineA);
    const seenB = watchProgress(engineB);
    let countA = 0;
    let countB = 0;
    engineA.hooks.hook("scene:preload", (event) => {
      countA += 1;
      event.progress("x", 1, 2);
    });
    engineB.hooks.hook("scene:preload", (event) => {
      countB += 1;
      event.progress("y", 1, 4);
    });
    await runScenePreload(engineA, "menu", "level");
    expect(seenA).toEqual([0, 0.5, 1]);
    expect(countA).toBe(1);
    expect(seenB).toEqual([]);
    expect(countB).toBe(0);
    await runScenePreload(engineB, "menu", "level");
    expect(seenB).toEqual([0, 0.25, 1]);
    expect(countB).toBe(1);
    expect(seenA).toEqual([0, 0.5, 1]);
    expect(countA).toBe(1);
  });

  it("a throwing progress listener is reported and the preload still resolves", async () => {
    const engine = await loadEngine();
    const bus = watchErrors(engine);
    const boom = new Error("listener boom");
    engine.hooks.hook("scene:preload:progress", () => {
      throw boom;
    });
    engine.hooks.hook("scene:preload", (event) => {
      event.progress("a", 1, 2);
    });
    await runScenePreload(engine, "menu", "level");
    // reportRejectedHook emits on a microtask. One macrotask lets that handler run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const payload: GwenErrorPayload = {
      level: "error",
      code: "CORE:PLUGIN_RUNTIME_ERROR",
      message: boom.message,
      source: "scene:level",
      error: boom,
      context: { frame: engine.frameCount, hook: "scene:preload:progress" },
    };
    expect(bus).toEqual([payload, payload, payload]);
  });

  it("a report that reaches the total does not emit 1 before the handlers resolve", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    const held = gate();
    engine.hooks.hook("scene:preload", async (event) => {
      event.progress("a", 1, 1);
      await held.promise;
    });
    const run = runScenePreload(engine, "menu", "level");
    try {
      expect(seen).toEqual([0]);
      held.open();
      await run;
      expect(seen).toEqual([0, 1]);
    } finally {
      held.open();
    }
  });

  it("loaded above total counts as the task total", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    engine.hooks.hook("scene:preload", (event) => {
      event.progress("a", 5, 2);
      event.progress("b", 0, 2);
      event.progress("b", 2, 2);
    });
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 0.5, 1]);
  });

  it("loaded below zero counts as zero", async () => {
    const engine = await loadEngine();
    const seen = watchProgress(engine);
    engine.hooks.hook("scene:preload", (event) => {
      event.progress("a", -3, 2);
      event.progress("b", 1, 2);
    });
    await runScenePreload(engine, "menu", "level");
    expect(seen).toEqual([0, 0.25, 1]);
  });
});
