import { afterEach, describe, expect, it } from "vitest";
import type { ScenePreloadEvent } from "@gwenjs/schema";
import { createEngine } from "../../src/node.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { useEngine } from "../../src/engine/context.js";
import { GwenScenePreloadError } from "../../src/scene/scene-preload-error.js";
import { runScenePreload } from "../../src/scene/run-scene-preload.js";
import { SceneEnginePlugin } from "../../src/scene/engine-plugin.js";
import { defineScene } from "../../src/scene/runtime/define-scene.js";
import { onPreload } from "../../src/scene/runtime/scene-context.js";

const REGISTRY = { register: () => {} };

const sharedCounts = new Map<GwenEngine, number>();

const SharedScene = defineScene("SharedPreload", () => {
  onPreload(() => {
    const current = useEngine();
    sharedCounts.set(current, (sharedCounts.get(current) ?? 0) + 1);
  });
});

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

describe("onPreload scene:preload", () => {
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

  it("runScenePreload runs the onPreload callbacks of the target scene only", async () => {
    const engine = await loadEngine();
    await engine.use(SceneEnginePlugin());
    const log: string[] = [];
    const events: ScenePreloadEvent[] = [];
    const Menu = defineScene("Menu", () => {
      onPreload(() => {
        log.push("menu-1");
      });
    });
    const Game = defineScene("Game", () => {
      onPreload((event) => {
        log.push("game-1");
        events.push(event);
      });
      onPreload((event) => {
        log.push("game-2");
        events.push(event);
      });
    });
    engine.run(() => {
      Menu(REGISTRY);
      Game(REGISTRY);
    });

    await runScenePreload(engine, "Menu", "Game");
    expect(log).toEqual(["game-1", "game-2"]);
    expect(events).toHaveLength(2);
    expect(events[0]?.from).toBe("Menu");
    expect(events[0]?.to).toBe("Game");
    expect(events[1]?.from).toBe("Menu");
    expect(events[1]?.to).toBe("Game");

    await runScenePreload(engine, "Game", "Menu");
    expect(log).toEqual(["game-1", "game-2", "menu-1"]);
  });

  it("the callbacks of one scene start before either resolves", async () => {
    const engine = await loadEngine();
    await engine.use(SceneEnginePlugin());
    const started: string[] = [];
    const held = gate();
    const Scene = defineScene("ParallelPreload", () => {
      onPreload(async () => {
        started.push("a");
        await held.promise;
      });
      onPreload(async () => {
        started.push("b");
        await held.promise;
      });
    });
    engine.run(() => {
      Scene(REGISTRY);
    });
    const run = runScenePreload(engine, "menu", "ParallelPreload");
    try {
      expect(started).toEqual(["a", "b"]);
      held.open();
      await run;
    } finally {
      held.open();
    }
  });

  it("a callback that throws synchronously rejects the preload and the next callback still starts", async () => {
    const engine = await loadEngine();
    await engine.use(SceneEnginePlugin());
    const boom = new Error("boom");
    const started: string[] = [];
    const Scene = defineScene("ThrowPreload", () => {
      onPreload(() => {
        throw boom;
      });
      onPreload(() => {
        started.push("b");
      });
    });
    engine.run(() => {
      Scene(REGISTRY);
    });
    const error = await rejectionOf(runScenePreload(engine, "menu", "ThrowPreload"));
    expect(error).toBeInstanceOf(GwenScenePreloadError);
    if (!(error instanceof GwenScenePreloadError)) return;
    expect(error.cause).toBe(boom);
    expect(started).toEqual(["b"]);
  });

  it("without SceneEnginePlugin the direct fallback runs onPreload", async () => {
    const engine = await loadEngine();
    let runs = 0;
    const Scene = defineScene("FallbackPreload", () => {
      onPreload(() => {
        runs += 1;
      });
    });
    engine.run(() => {
      Scene(REGISTRY);
    });
    await runScenePreload(engine, null, "FallbackPreload");
    expect(runs).toBe(1);
  });

  it("two engines run a shared scene definition once each", async () => {
    const engineA = await loadEngine();
    const engineB = await loadEngine();
    await engineA.use(SceneEnginePlugin());
    await engineB.use(SceneEnginePlugin());
    sharedCounts.clear();
    engineA.run(() => {
      SharedScene(REGISTRY);
    });
    engineB.run(() => {
      SharedScene(REGISTRY);
    });

    await runScenePreload(engineA, null, "SharedPreload");
    expect(sharedCounts.get(engineA) ?? 0).toBe(1);
    expect(sharedCounts.get(engineB) ?? 0).toBe(0);

    await runScenePreload(engineB, null, "SharedPreload");
    expect(sharedCounts.get(engineB) ?? 0).toBe(1);
    expect(sharedCounts.get(engineA) ?? 0).toBe(1);
  });
});
