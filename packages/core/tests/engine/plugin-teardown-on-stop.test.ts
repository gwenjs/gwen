/**
 * stop() and unuse() share one removal path: services, cleanup, teardown.
 */
import { createHooks } from "hookable";
import { afterEach, describe, expect, it } from "vitest";
import type { GwenErrorPayload, IGwenLogger } from "@gwenjs/schema";
import { engineContext } from "../../src/engine/context";
import type { EngineErrorBus, GwenPlugin } from "../../src/engine/engine-types";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";
import { ScopedHooksTracker } from "../../src/engine/hook-tracker";
import { PluginRegistry, type PluginRegistryDeps } from "../../src/engine/plugin-registry";
import { ServiceContainer } from "../../src/engine/service-container";
import {
  createEngine as openEngine,
  GwenPluginNotFoundError,
  onCleanup,
  type GwenEngine as PublicEngine,
} from "../../src/index";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    svc: { tag: string };
    k: { tag: string };
    a: { tag: string };
    b: { tag: string };
  }
}

const engines: PublicEngine[] = [];

async function createEngine(): Promise<PublicEngine> {
  const engine = await openEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function recording(name: string, order: string[]): GwenPlugin {
  return {
    name,
    setup() {},
    teardown() {
      order.push(name);
    },
  };
}

describe("plugin teardown on stop", () => {
  it("stop() tears 0, 1 and 3 plugins down in reverse install order", async () => {
    const noneOrder: string[] = [];
    const none = await createEngine();
    await none.stop();

    const oneOrder: string[] = [];
    const one = await createEngine();
    await one.use(recording("A", oneOrder));
    await one.stop();

    const threeOrder: string[] = [];
    const three = await createEngine();
    await three.use(recording("B", threeOrder));
    await three.use(recording("A", threeOrder));
    await three.use(recording("C", threeOrder));
    await three.stop();

    expect([noneOrder, oneOrder, threeOrder]).toEqual([[], ["A"], ["C", "A", "B"]]);
  });

  it("a throwing teardown reports one error and the others still run", async () => {
    const engine = await createEngine();
    const ran: string[] = [];
    const events: GwenErrorPayload[] = [];
    await engine.use({
      name: "B",
      setup() {},
      teardown() {
        ran.push("B");
      },
    });
    await engine.use({
      name: "A",
      setup() {},
      teardown() {
        ran.push("A");
        throw new Error("teardown failed");
      },
    });
    await engine.use({
      name: "C",
      setup() {},
      teardown() {
        ran.push("C");
      },
    });
    engine.errors.on((event) => {
      events.push(event);
    });
    await engine.stop();
    expect(events).toEqual([
      expect.objectContaining({
        level: "error",
        code: "CORE:PLUGIN_RUNTIME_ERROR",
        target: { kind: "plugin", id: "A", name: "A" },
      }),
    ]);
    expect(ran).toEqual(["C", "A", "B"]);
    expect(engine.state).toBe("stopped");
  });

  it("onError recover() on teardown suppresses the bus event", async () => {
    const engine = await createEngine();
    const phases: string[] = [];
    const events: GwenErrorPayload[] = [];
    let hits = 0;
    engine.errors.on((event) => {
      events.push(event);
    });
    await engine.use({
      name: "P",
      setup(host) {
        host.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
      teardown() {
        throw new Error("teardown failed");
      },
      onError(_error, ctx) {
        phases.push(ctx.phase);
        ctx.recover();
      },
    });
    await engine.stop();
    expect(events).toHaveLength(0);
    expect(phases).toEqual(["teardown"]);
    hits = 0;
    await engine.hooks.callHook("engine:update", 0);
    expect(hits).toBe(0);
  });

  it("two stop() calls run each teardown once", async () => {
    const sequential: string[] = [];
    const first = await createEngine();
    await first.use(recording("A", sequential));
    await first.use(recording("B", sequential));
    await first.stop();
    await first.stop();

    const concurrent: string[] = [];
    const second = await createEngine();
    await second.use(recording("A", concurrent));
    await second.use(recording("B", concurrent));
    await Promise.all([second.stop(), second.stop()]);

    expect(sequential).toEqual(["B", "A"]);
    expect(concurrent).toEqual(["B", "A"]);
  });

  it("stop() in faulted runs teardown once and stays faulted", async () => {
    const engine = await createEngine();
    const torn: string[] = [];
    await engine.use({
      name: "P",
      setup(host) {
        host.provide("svc", { tag: "faulted" });
      },
      teardown() {
        torn.push("P");
      },
    });
    engine.hooks.hook("engine:start", () => {
      throw new Error("boom");
    });
    await expect(engine.startExternal()).rejects.toThrow("boom");
    expect(engine.state).toBe("faulted");
    await engine.stop();
    expect(torn).toEqual(["P"]);
    expect(engine.tryInject("svc")).toBeUndefined();
    expect(engine.state).toBe("faulted");
    await engine.stop();
    expect(torn).toEqual(["P"]);
    expect(engine.state).toBe("faulted");
  });

  it("withCleanup disposers registered in setup run on stop()", async () => {
    const engine = await createEngine();
    const tokens: string[] = [];
    await engine.use({
      name: "P",
      setup() {
        onCleanup(() => {
          tokens.push("cleaned");
        });
      },
    });
    await engine.stop();
    expect(tokens).toEqual(["cleaned"]);
  });

  it("a service provided in setup is gone after stop()", async () => {
    const engine = await createEngine();
    const value = { tag: "after-await" };
    await engine.use({
      name: "P",
      async setup(host) {
        await Promise.resolve();
        host.provide("svc", value);
      },
    });
    await engine.stop();
    expect(engine.tryInject("svc")).toBeUndefined();
    expect(() => engine.inject("svc")).toThrow(GwenPluginNotFoundError);
  });

  it("a service provided in setup is gone after unuse()", async () => {
    const engine = await createEngine();
    const value = { tag: "after-await" };
    await engine.use({
      name: "P",
      async setup(host) {
        await Promise.resolve();
        host.provide("svc", value);
      },
    });
    await engine.unuse("P");
    expect(engine.tryInject("svc")).toBeUndefined();
    expect(() => engine.inject("svc")).toThrow(GwenPluginNotFoundError);
  });

  it("unuse removes a plugin's own service but never an engine-owned key it re-provided", async () => {
    const engine = await createEngine();
    const pluginMemory = { tag: "plugin-memory" };
    const bridge = engine.inject("wasm:bridge");
    const logger = engine.inject("logger");
    const errors = engine.inject("errors");
    await engine.use({
      name: "P",
      setup(host) {
        host.provide("svc", { tag: "svc" });
        host.provide("memory", pluginMemory);
      },
    });
    await engine.unuse("P");
    expect(engine.tryInject("svc")).toBeUndefined();
    expect(engine.inject("wasm:bridge")).toBe(bridge);
    expect(engine.inject("logger")).toBe(logger);
    expect(engine.inject("errors")).toBe(errors);
    expect(engine.inject("memory")).toBe(pluginMemory);
  });

  it("removal deletes a key only while it holds the plugin's own value", async () => {
    const engine = await createEngine();
    const first = { tag: "p1" };
    const second = { tag: "p2" };
    await engine.use({
      name: "P1",
      setup(host) {
        host.provide("k", first);
      },
    });
    await engine.use({
      name: "P2",
      setup(host) {
        host.provide("k", second);
      },
    });
    await engine.unuse("P1");
    expect(engine.inject("k")).toBe(second);
    await engine.unuse("P2");
    expect(engine.tryInject("k")).toBeUndefined();
  });

  it("teardown runs after the plugin's own services are removed", async () => {
    const engine = await createEngine();
    const value = { tag: "svc" };
    const seen: unknown[] = [];
    await engine.use({
      name: "P",
      setup(host) {
        host.provide("svc", value);
      },
      teardown() {
        seen.push(engine.tryInject("svc"));
      },
    });
    await engine.unuse("P");
    expect(seen).toEqual([undefined]);
  });

  it("two keys are removed in reverse provide order", async () => {
    const deleted: string[] = [];
    const container = new ServiceContainer({
      assertState() {},
    });
    const hooks = createHooks<GwenRuntimeHooks>();
    const receiver = {
      hooks,
      provide(key: string, value: unknown) {
        if ((key === "a" || key === "b") && isTag(value)) container.provide(key, value);
      },
    };
    const logger: IGwenLogger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return logger;
      },
    };
    const errors: EngineErrorBus = {
      emit() {},
      on() {
        return () => {};
      },
      onFatal() {
        return () => {};
      },
    };
    const deps: PluginRegistryDeps = {
      hooks,
      tracker: new ScopedHooksTracker(),
      errors,
      assertState() {},
      logger,
      debug: false,
      remember() {},
      frame: () => 0,
      reportSetup() {},
      reportTeardown() {},
      dropIsolation() {},
      hasService() {
        return false;
      },
      deleteService(key, expected) {
        deleted.push(key);
        if (key === "a" || key === "b") return container.delete(key, expected);
        return false;
      },
      writeService(key, value) {
        if ((key === "a" || key === "b") && isTag(value)) container.provide(key, value);
        return { kind: "created" };
      },
      emitServiceChange() {},
    };
    const registry = new PluginRegistry(deps);
    try {
      await registry.use(
        {
          name: "P",
          setup(host) {
            host.provide("a", { tag: "a" });
            host.provide("b", { tag: "b" });
          },
        },
        receiver,
      );
      await registry.unuse("P", receiver);
      expect(deleted).toEqual(["b", "a"]);
    } finally {
      engineContext.unset();
    }
  });

  it("hooks registered by a plugin are live during teardown and gone after stop() and unuse()", async () => {
    const stopped = await createEngine();
    const during: boolean[] = [];
    let stopHits = 0;
    await stopped.use({
      name: "P",
      setup(host) {
        host.hooks.hook("engine:update", () => {
          stopHits += 1;
        });
      },
      async teardown() {
        stopHits = 0;
        await stopped.hooks.callHook("engine:update", 0);
        during.push(stopHits === 1);
      },
    });
    await stopped.stop();
    expect(during).toEqual([true]);
    stopHits = 0;
    await stopped.hooks.callHook("engine:update", 0);
    expect(stopHits).toBe(0);

    const removed = await createEngine();
    let unuseHits = 0;
    await removed.use({
      name: "P",
      setup(host) {
        host.hooks.hook("engine:update", () => {
          unuseHits += 1;
        });
      },
    });
    await removed.unuse("P");
    unuseHits = 0;
    await removed.hooks.callHook("engine:update", 0);
    expect(unuseHits).toBe(0);
  });

  it("stopping one engine tears down its plugins and leaves another engine's plugins installed", async () => {
    const firstOrder: string[] = [];
    const secondOrder: string[] = [];
    const first = await createEngine();
    const second = await createEngine();
    await first.use(recording("P", firstOrder));
    await second.use({
      name: "Q",
      setup(host) {
        host.provide("svc", { tag: "engine-2" });
      },
      teardown() {
        secondOrder.push("Q");
      },
    });
    await first.stop();
    expect(firstOrder).toEqual(["P"]);
    expect(secondOrder).toEqual([]);
    expect(second.inject("svc")).toEqual({ tag: "engine-2" });
  });

  it("stop() called from a teardown returns and teardown continues", async () => {
    const engine = await createEngine();
    const order: string[] = [];
    await engine.use({
      name: "B",
      setup() {},
      teardown() {
        order.push("B");
      },
    });
    await engine.use({
      name: "A",
      setup() {},
      async teardown() {
        await engine.stop();
        order.push("A-returned");
      },
    });
    await engine.stop();
    expect(order).toEqual(["A-returned", "B"]);
  });

  it("async teardowns run one after the other", async () => {
    const engine = await createEngine();
    const marks: string[] = [];
    await engine.use({
      name: "A",
      setup() {},
      teardown() {
        marks.push("A-start");
      },
    });
    await engine.use({
      name: "C",
      setup() {},
      async teardown() {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        marks.push("C-end");
      },
    });
    await engine.stop();
    expect(marks).toEqual(["C-end", "A-start"]);
  });

  it("a throwing onCleanup on stop() still tears the other plugins down and reaches stopped", async () => {
    const engine = await createEngine();
    const order: string[] = [];
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    await engine.use({
      name: "B",
      setup() {},
      teardown() {
        order.push("B");
      },
    });
    await engine.use({
      name: "A",
      setup() {
        onCleanup(() => {
          order.push("A-cleanup");
          throw new Error("x");
        });
      },
      teardown() {
        order.push("A-teardown");
      },
    });
    await engine.stop().then(
      () => undefined,
      () => undefined,
    );
    expect(order).toEqual(["A-cleanup", "A-teardown", "B"]);
    expect(engine.state).toBe("stopped");
    expect(events).toEqual([
      expect.objectContaining({
        level: "error",
        code: "CORE:PLUGIN_RUNTIME_ERROR",
        target: { kind: "plugin", id: "A", name: "A" },
      }),
    ]);
  });

  it("two unuse() calls for one plugin run teardown once and stop() still tears the other down", async () => {
    const engine = await createEngine();
    let xCount = 0;
    let aCount = 0;
    let aHits = 0;
    await engine.use({
      name: "A",
      setup(host) {
        host.provide("svc", { tag: "a" });
        host.hooks.hook("engine:update", () => {
          aHits += 1;
        });
      },
      teardown() {
        aCount += 1;
      },
    });
    await engine.use({
      name: "X",
      setup() {},
      teardown() {
        xCount += 1;
      },
    });
    await Promise.all([engine.unuse("X"), engine.unuse("X")]);
    expect(xCount).toBe(1);
    await engine.stop();
    expect(aCount).toBe(1);
    aHits = 0;
    await engine.hooks.callHook("engine:update", 0);
    expect(aHits).toBe(0);
    expect(engine.tryInject("svc")).toBeUndefined();
  });

  it("stop() during an in-flight unuse tears that plugin down once", async () => {
    const engine = await createEngine();
    let open = false;
    const waiters: Array<() => void> = [];
    const release = (): void => {
      open = true;
      const queued = waiters.splice(0);
      for (const resolve of queued) resolve();
    };
    const gate = (): Promise<void> => {
      if (open) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    };
    let xCount = 0;
    let aCount = 0;
    try {
      await engine.use({
        name: "A",
        setup() {},
        teardown() {
          aCount += 1;
        },
      });
      await engine.use({
        name: "X",
        setup() {},
        teardown() {
          xCount += 1;
          return gate();
        },
      });
      const pending = engine.unuse("X");
      expect(xCount).toBe(1);
      const stopping = engine.stop();
      // stop() awaits the state change and engine:stop before teardownAll.
      // Flush those ticks while X's teardown is still pending, then read the count.
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      const seenWhileInFlight = xCount;
      release();
      const outcome = await new Promise<string>((resolve) => {
        stopping.then(
          () => resolve(engine.state),
          () => resolve("rejected"),
        );
        setTimeout(() => resolve("hung"), 0);
      });
      await pending.then(
        () => undefined,
        () => undefined,
      );
      expect(seenWhileInFlight).toBe(1);
      expect(outcome).toBe("stopped");
      expect(xCount).toBe(1);
      expect(aCount).toBe(1);
    } finally {
      release();
    }
  });

  it("a setup that throws after provide leaves no service", async () => {
    const syncEngine = await createEngine();
    const shared = { tag: "shared" };
    await expect(
      syncEngine.use({
        name: "P",
        setup(host) {
          host.provide("svc", shared);
          throw new Error("setup failed");
        },
      }),
    ).rejects.toThrow("setup failed");
    expect(syncEngine.tryInject("svc")).toBeUndefined();
    await syncEngine.use({
      name: "Q",
      setup(host) {
        host.provide("svc", shared);
      },
    });
    await syncEngine.use({
      name: "P",
      setup() {},
    });
    await syncEngine.unuse("P");
    expect(syncEngine.inject("svc")).toBe(shared);
    await syncEngine.stop();
    expect(syncEngine.tryInject("svc")).toBeUndefined();

    const asyncEngine = await createEngine();
    const asyncValue = { tag: "after-await" };
    await expect(
      asyncEngine.use({
        name: "P",
        async setup(host) {
          await Promise.resolve();
          host.provide("svc", asyncValue);
          throw new Error("setup failed");
        },
      }),
    ).rejects.toThrow("setup failed");
    expect(asyncEngine.tryInject("svc")).toBeUndefined();
    await asyncEngine.stop();
    expect(asyncEngine.tryInject("svc")).toBeUndefined();
  });
});

function isTag(value: unknown): value is { tag: string } {
  return typeof value === "object" && value !== null && "tag" in value;
}
