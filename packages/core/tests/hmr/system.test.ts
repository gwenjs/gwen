import { afterEach, describe, expect, it } from "vitest";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { onCleanup, useHook } from "../../src/hooks/index.js";
import { hotReplaceSystem, type GwenHotReport } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { createSystemHandle } from "../../src/scene/runtime/system-handle";
import {
  defineSystem,
  type DiscoverablePlugin,
  onAfterUpdate,
  onBeforeUpdate,
  onRender,
  onUpdate,
} from "../../src/system/runtime/define-system";

const engines: GwenEngine[] = [];

async function boot(config?: { physicsHz: number }): Promise<GwenEngine> {
  const engine = await createEngine(config);
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

/** One system whose update body pushes `tag` into `order`. */
function pusher(name: string, tag: string, order: string[]) {
  return defineSystem(name, () => {
    onUpdate(() => {
      order.push(tag);
    });
  });
}

describe.runIf(__GWEN_DEV__)("hotReplaceSystem", () => {
  it("the swapped body runs on the next frame and the entity count is unchanged", async () => {
    const engine = await boot();
    let a = 0;
    let b = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        a++;
      });
    });
    const Sys2 = defineSystem("Counter", () => {
      onUpdate(() => {
        b++;
      });
    });
    for (let i = 0; i < 10; i++) engine.createEntity();
    await engine.use(Sys());
    await engine.advance(0.016);

    const report = await hotReplaceSystem(Sys, Sys2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(engine.getStats().entityCount).toBe(10);
  });

  it("the system keeps its position within every phase it already used", async () => {
    const engine = await boot();
    const order: string[] = [];
    const both = (name: string, tag: string) =>
      defineSystem(name, () => {
        onBeforeUpdate(() => {
          order.push(`${tag}:bu`);
        });
        onUpdate(() => {
          order.push(`${tag}:u`);
        });
      });
    const A = both("A", "A");
    const B = both("B", "B");
    const C = both("C", "C");
    const B2 = both("B", "B2");
    await engine.use(A());
    await engine.use(B());
    await engine.use(C());

    const report = await hotReplaceSystem(B, B2);
    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "B", count: 1 });
    const frame = ["A:bu", "B2:bu", "C:bu", "A:u", "B2:u", "C:u"];
    expect(order).toEqual([...frame, ...frame]);
  });

  it("a phase used for the first time runs last", async () => {
    const engine = await boot();
    const order: string[] = [];
    const late = (name: string) =>
      defineSystem(name, () => {
        onAfterUpdate(() => {
          order.push(`${name}:au`);
        });
      });
    const A = late("A");
    const C = late("C");
    const B = pusher("B", "B:u", order);
    const B2 = defineSystem("B", () => {
      onUpdate(() => {
        order.push("B2:u");
      });
      onAfterUpdate(() => {
        order.push("B2:au");
      });
    });
    await engine.use(A());
    await engine.use(B());
    await engine.use(C());

    const report = await hotReplaceSystem(B, B2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "B", count: 1 });
    expect(order).toEqual(["B2:u", "A:au", "C:au", "B2:au"]);
  });

  it("user and scene pause flags are kept", async () => {
    const engine = await boot();
    let a = 0;
    let b = 0;
    let c = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        a++;
      });
    });
    const Sys2 = defineSystem("Counter", () => {
      onUpdate(() => {
        b++;
      });
    });
    const Sys3 = defineSystem("Counter", () => {
      onUpdate(() => {
        c++;
      });
    });
    const { plugin, handle } = createSystemHandle(Sys());
    await engine.use(plugin);

    handle.pause();
    const first = await hotReplaceSystem(Sys, Sys2);
    await engine.advance(0.016);
    const whilePaused = b;
    handle.resume();
    await engine.advance(0.016);
    const afterResume = b;

    // A user pause must survive the end of a scene pause.
    handle.pause();
    handle._scenePause();
    const second = await hotReplaceSystem(Sys2, Sys3);
    handle._sceneResume();
    await engine.advance(0.016);
    const userPauseKept = c;
    handle.resume();
    await engine.advance(0.016);

    expect(first).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect(second).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect({ a, whilePaused, afterResume, userPauseKept, c }).toEqual({
      a: 0,
      whilePaused: 0,
      afterResume: 1,
      userPauseKept: 0,
      c: 1,
    });
  });

  it("closure state is reset", async () => {
    const engine = await boot();
    const seen: number[] = [];
    const counting = () =>
      defineSystem("Counter", () => {
        let n = 0;
        onUpdate(() => {
          seen.push(++n);
        });
      });
    const Sys = counting();
    const Sys2 = counting();
    await engine.use(Sys());
    await engine.advance(0.016);
    await engine.advance(0.016);

    const report = await hotReplaceSystem(Sys, Sys2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect(seen).toEqual([1, 2, 1]);
  });

  it("the isolation entry of the old scope is dropped", async () => {
    const engine = await boot();
    let fixed = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        throw new Error("boom");
      });
    });
    const Sys2 = defineSystem("Counter", () => {
      onUpdate(() => {
        fixed++;
      });
    });
    await engine.use(Sys());
    await engine.advance(0.016);
    const isolatedBefore = engine.isolated().map((target) => target.name);

    const report = await hotReplaceSystem(Sys, Sys2);
    await engine.advance(0.016);

    expect(isolatedBefore).toEqual(["Counter"]);
    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect(engine.isolated()).toEqual([]);
    expect(fixed).toBe(1);
  });

  it("a throwing new body stays isolated, emits CORE:PLUGIN_RUNTIME_ERROR with target and other systems keep running", async () => {
    const engine = await boot();
    const events: Array<{ code: string; kind: string | undefined; name: string | undefined }> = [];
    engine.errors.on((event) => {
      events.push({ code: event.code, kind: event.target?.kind, name: event.target?.name });
    });
    let a = 0;
    let other = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        a++;
      });
    });
    const Broken = defineSystem("Counter", () => {
      throw new Error("boom");
    });
    const Other = defineSystem("Other", () => {
      onUpdate(() => {
        other++;
      });
    });
    await engine.use(Sys());
    await engine.use(Other());
    await engine.advance(0.016);

    const report = await hotReplaceSystem(Sys, Broken);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 0 });
    expect(events).toEqual([
      { code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "system", name: "Counter" },
    ]);
    expect(engine.isolated().map((target) => target.name)).toEqual(["Counter"]);
    expect(a).toBe(1);
    expect(other).toBe(2);
  });

  it("a non-running state returns reload engine-not-running", async () => {
    const engine = await boot();
    const Sys = pusher("Counter", "old", []);
    const Sys2 = pusher("Counter", "new", []);
    await engine.use(Sys());

    const stopping = engine.stop();
    const report = await hotReplaceSystem(Sys, Sys2);
    await stopping;

    expect(report).toEqual({
      status: "reload",
      kind: "system",
      name: "Counter",
      reason: "engine-not-running",
    });
  });

  it("a swap to a system with another name applies with count 0 and leaves the install", async () => {
    const engine = await boot();
    let a = 0;
    let b = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        a++;
      });
    });
    const Renamed = defineSystem("Renamed", () => {
      onUpdate(() => {
        b++;
      });
    });
    await engine.use(Sys());

    const report = await hotReplaceSystem(Sys, Renamed);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 0 });
    expect({ a, b }).toEqual({ a: 1, b: 0 });
  });

  it("two engines with the same definition are both swapped", async () => {
    const first = await boot();
    const second = await boot();
    interface Hits {
      n: number;
      m: number;
    }
    const Sys = defineSystem("Counter", (hits: Hits) => {
      onUpdate(() => {
        hits.n++;
      });
    });
    const Sys2 = defineSystem("Counter", (hits: Hits) => {
      onUpdate(() => {
        hits.m++;
      });
    });
    const one: Hits = { n: 0, m: 0 };
    const two: Hits = { n: 0, m: 0 };
    await first.use(Sys(one));
    await second.use(Sys(two));

    const report = await hotReplaceSystem(Sys, Sys2);
    await first.advance(0.016);
    const afterFirst = { one: { ...one }, two: { ...two } };
    await second.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 2 });
    expect(afterFirst).toEqual({ one: { n: 0, m: 1 }, two: { n: 0, m: 0 } });
    expect(two).toEqual({ n: 0, m: 1 });
  });

  it("swapping an uninstalled definition applies with count 0", async () => {
    const Ghost = pusher("Ghost", "old", []);
    const Ghost2 = pusher("Ghost", "new", []);

    expect(await hotReplaceSystem(Ghost, Ghost2)).toEqual({
      status: "applied",
      kind: "system",
      name: "Ghost",
      count: 0,
    });
  });

  it("after 50 swaps the hook count equals the cold-start count", async () => {
    const engine = await boot();
    const generations: number[] = [];
    const generation = (n: number) =>
      defineSystem("Counter", () => {
        onBeforeUpdate(() => {});
        onUpdate(() => {
          generations.push(n);
        });
      });
    let current = generation(0);
    await engine.use(current());
    const cold = {
      hookListeners: engine.getStats().hookListeners,
      plugins: engine.getStats().plugins,
    };

    let last: GwenHotReport | undefined;
    for (let n = 1; n <= 50; n++) {
      const next = generation(n);
      last = await hotReplaceSystem(current, next);
      current = next;
      await engine.advance(0.016);
    }

    expect(last).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect(generations.at(-1)).toBe(50);
    expect({
      hookListeners: engine.getStats().hookListeners,
      plugins: engine.getStats().plugins,
    }).toEqual(cold);
  });

  it("a swap requested inside onUpdate applies only after afterTick", async () => {
    const engine = await boot();
    let oldRuns = 0;
    let newRuns = 0;
    let swap: Promise<GwenHotReport> | undefined;
    const Sys: (...args: []) => DiscoverablePlugin = defineSystem("Counter", () => {
      onUpdate(() => {
        oldRuns++;
        swap ??= hotReplaceSystem(Sys, Sys2);
      });
    });
    const Sys2 = defineSystem("Counter", () => {
      onAfterUpdate(() => {
        newRuns++;
      });
    });
    await engine.use(Sys());

    await engine.advance(0.016);
    const sameFrame = { oldRuns, newRuns };
    const report = await swap;
    await engine.advance(0.016);

    expect(sameFrame).toEqual({ oldRuns: 1, newRuns: 0 });
    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 1 });
    expect({ oldRuns, newRuns }).toEqual({ oldRuns: 1, newRuns: 1 });
  });

  it("after stop() the definition has no install and a swap applies with count 0", async () => {
    const engine = await boot();
    const Sys = pusher("Counter", "old", []);
    const Sys2 = pusher("Counter", "new", []);
    await engine.use(Sys());
    await engine.stop();

    expect(await hotReplaceSystem(Sys, Sys2)).toEqual({
      status: "applied",
      kind: "system",
      name: "Counter",
      count: 0,
    });
  });

  describe("with a fixed step (physicsHz)", () => {
    /** A runs first and asks the swap of B (once) from `phase`. Every body logs its phase. */
    function rig(phase: "update" | "render") {
      const log: string[] = [];
      const ask: { swap?: Promise<GwenHotReport> } = {};
      const A = defineSystem("A", () => {
        onUpdate(() => {
          log.push("A:update");
          if (phase === "update") ask.swap ??= hotReplaceSystem(B, B2);
        });
        onRender(() => {
          log.push("A:render");
          if (phase === "render") ask.swap ??= hotReplaceSystem(B, B2);
        });
      });
      const B: (...args: []) => DiscoverablePlugin = defineSystem("B", () => {
        onUpdate(() => {
          log.push("B:update");
        });
        onRender(() => {
          log.push("B:render");
        });
      });
      const B2 = defineSystem("B", () => {
        onUpdate(() => {
          log.push("B2:update");
        });
        onRender(() => {
          log.push("B2:render");
        });
      });
      return { log, ask, A, B };
    }

    it("a swap asked in a step applies after the render pass of the display frame", async () => {
      const engine = await boot({ physicsHz: 60 });
      const { log, ask, A, B } = rig("update");
      await engine.use(A());
      await engine.use(B());
      await engine.startExternal();

      await engine.advance(2 / 60 + 0.001);
      const firstFrame = log.splice(0);
      const report = await ask.swap;
      await engine.advance(1 / 60 + 0.001);

      expect(firstFrame).toEqual([
        "A:update",
        "B:update",
        "A:update",
        "B:update",
        "A:render",
        "B:render",
      ]);
      expect(report).toEqual({ status: "applied", kind: "system", name: "B", count: 1 });
      expect(log).toEqual(["A:update", "B2:update", "A:render", "B2:render"]);
    });

    it("a swap asked in onRender applies after the render pass", async () => {
      const engine = await boot({ physicsHz: 60 });
      const { log, ask, A, B } = rig("render");
      await engine.use(A());
      await engine.use(B());
      await engine.startExternal();

      await engine.advance(1 / 60 + 0.001);
      const firstFrame = log.splice(0);
      const report = await ask.swap;
      await engine.advance(1 / 60 + 0.001);

      expect(firstFrame).toEqual(["A:update", "B:update", "A:render", "B:render"]);
      expect(report).toEqual({ status: "applied", kind: "system", name: "B", count: 1 });
      expect(log).toEqual(["A:update", "B2:update", "A:render", "B2:render"]);
    });
  });

  it("a cleanup that unsubscribes a hook after the swap leaves the new body subscribed", async () => {
    const engine = await boot();
    let oldRuns = 0;
    let newRuns = 0;
    const Sys = defineSystem("Counter", () => {
      const off = useHook("engine:update", () => {
        oldRuns++;
      });
      onCleanup(off);
    });
    const Sys2 = defineSystem("Counter", () => {
      useHook("engine:update", () => {
        newRuns++;
      });
    });
    await engine.use(Sys());
    const cold = engine.getStats().hookListeners;

    await hotReplaceSystem(Sys, Sys2);
    await engine.advance(0.016);

    expect({ oldRuns, newRuns }).toEqual({ oldRuns: 0, newRuns: 1 });
    expect(engine.getStats().hookListeners).toBe(cold);
  });

  it("a swapped system can be unused and used again, and unuse leaves no handler", async () => {
    const engine = await boot();
    let oldRuns = 0;
    let newRuns = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        oldRuns++;
      });
    });
    const Sys2 = defineSystem("Counter", () => {
      onUpdate(() => {
        newRuns++;
      });
    });
    const before = engine.getStats().hookListeners;
    const plugin = Sys();
    await engine.use(plugin);
    await hotReplaceSystem(Sys, Sys2);
    await engine.unuse("Counter");

    await engine.use(plugin);
    await engine.advance(0.016);
    const whileInstalled = { oldRuns, newRuns };
    await engine.unuse("Counter");
    await engine.advance(0.016);

    expect(whileInstalled).toEqual({ oldRuns: 0, newRuns: 1 });
    expect({ oldRuns, newRuns }).toEqual({ oldRuns: 0, newRuns: 1 });
    expect(engine.getStats().hookListeners).toBe(before);
  });

  it("after a swap and stop() the replacement has no install and a swap applies with count 0", async () => {
    const engine = await boot();
    const Sys = pusher("Counter", "old", []);
    const Sys2 = pusher("Counter", "new", []);
    const Sys3 = pusher("Counter", "newer", []);
    await engine.use(Sys());
    await hotReplaceSystem(Sys, Sys2);
    await engine.stop();

    expect(await hotReplaceSystem(Sys2, Sys3)).toEqual({
      status: "applied",
      kind: "system",
      name: "Counter",
      count: 0,
    });
  });

  it("unuse after a failed swap removes the parked handlers", async () => {
    const engine = await boot();
    const order: string[] = [];
    const Sys = pusher("Counter", "old", order);
    const Broken = defineSystem("Counter", () => {
      onBeforeUpdate(() => {});
      throw new Error("boom");
    });
    const before = engine.getStats().hookListeners;
    await engine.use(Sys());
    const failed = await hotReplaceSystem(Sys, Broken);
    await engine.unuse("Counter");
    await engine.advance(0.016);

    expect(failed).toEqual({ status: "applied", kind: "system", name: "Counter", count: 0 });
    expect(engine.getStats().hookListeners).toBe(before);
    expect(order).toEqual([]);
    expect(engine.isolated()).toEqual([]);
  });

  it("a pause made after a failed swap holds for the next good swap until resume", async () => {
    const engine = await boot();
    let fresh = 0;
    const Sys = pusher("Counter", "old", []);
    const Broken = defineSystem("Counter", () => {
      onUpdate(() => {});
      throw new Error("boom");
    });
    const Fixed = defineSystem("Counter", () => {
      onUpdate(() => {
        fresh++;
      });
    });
    const { plugin, handle } = createSystemHandle(Sys());
    await engine.use(plugin);
    await hotReplaceSystem(Sys, Broken);

    handle.pause();
    await hotReplaceSystem(Broken, Fixed);
    await engine.advance(0.016);
    const whilePaused = fresh;
    handle.resume();
    await engine.advance(0.016);

    expect({ whilePaused, afterResume: fresh }).toEqual({ whilePaused: 0, afterResume: 1 });
  });

  it("the handle of a swapped system reports the isolation of the new body", async () => {
    const engine = await boot();
    const Sys = pusher("Counter", "old", []);
    const Broken = defineSystem("Counter", () => {
      throw new Error("boom");
    });
    const { plugin, handle } = createSystemHandle(Sys());
    await engine.use(plugin);
    const before = handle.isolated;

    await hotReplaceSystem(Sys, Broken);

    expect({ before, after: handle.isolated }).toEqual({ before: false, after: true });
  });

  it("a failed swap keeps the phase position for the next swap", async () => {
    const engine = await boot();
    const order: string[] = [];
    const A = pusher("A", "A", order);
    const B = pusher("B", "B", order);
    const C = pusher("C", "C", order);
    const Broken = defineSystem("B", () => {
      throw new Error("boom");
    });
    const B2 = pusher("B", "B2", order);
    await engine.use(A());
    await engine.use(B());
    await engine.use(C());

    const failed = await hotReplaceSystem(B, Broken);
    const fixed = await hotReplaceSystem(Broken, B2);
    await engine.advance(0.016);

    expect(failed).toEqual({ status: "applied", kind: "system", name: "B", count: 0 });
    expect(fixed).toEqual({ status: "applied", kind: "system", name: "B", count: 1 });
    expect(order).toEqual(["A", "B2", "C"]);
    expect(engine.isolated()).toEqual([]);
  });
});

describe("hotReplaceSystem", () => {
  it.runIf(!__GWEN_DEV__)("a system installed in a prod build is not tracked", async () => {
    const engine = await boot();
    let a = 0;
    let b = 0;
    const Sys = defineSystem("Counter", () => {
      onUpdate(() => {
        a++;
      });
    });
    const Sys2 = defineSystem("Counter", () => {
      onUpdate(() => {
        b++;
      });
    });
    await engine.use(Sys());

    const report = await hotReplaceSystem(Sys, Sys2);
    await engine.advance(0.016);

    expect(report).toEqual({ status: "applied", kind: "system", name: "Counter", count: 0 });
    expect(a).toBe(1);
    expect(b).toBe(0);
  });
});
