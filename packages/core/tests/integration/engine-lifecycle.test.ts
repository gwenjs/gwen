/**
 * @file Integration — full engine lifecycle: createEngine → use(plugin) → start → advance(dt) → stop.
 *
 * These tests exercise the end-to-end pipeline without mocking internal engine
 * internals, verifying that the public API composes correctly across package boundaries.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createEngine } from "../../src/index.js";
import type { GwenPlugin } from "../../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a plugin that records its lifecycle phase invocations. */
function makeRecorder(name: string, log: string[]): GwenPlugin {
  return {
    name,
    setup(engine) {
      log.push(`${name}:setup`);
      engine.hooks.hook("engine:before-update", (dt) => {
        log.push(`${name}:beforeUpdate:${dt}`);
      });
      engine.hooks.hook("engine:update", (dt) => {
        log.push(`${name}:update:${dt}`);
      });
      engine.hooks.hook("engine:after-update", (dt) => {
        log.push(`${name}:afterUpdate:${dt}`);
      });
      engine.hooks.hook("engine:render", () => {
        log.push(`${name}:render`);
      });
    },
    teardown() {
      log.push(`${name}:teardown`);
    },
  };
}

// ─── Core lifecycle ───────────────────────────────────────────────────────────

describe("Engine lifecycle — createEngine → use → advance → unuse", () => {
  it("setup runs synchronously during engine.use()", async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder("A", log));
    expect(log).toContain("A:setup");
  });

  it("all frame phases receive the dt value from advance()", async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder("B", log));

    await engine.advance(0.016);

    expect(log).toContain("B:beforeUpdate:0.016");
    expect(log).toContain("B:update:0.016");
    expect(log).toContain("B:afterUpdate:0.016");
    expect(log).toContain("B:render");
  });

  it("frame phases execute in order: beforeUpdate → update → afterUpdate → render", async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder("C", log));

    await engine.advance(0.016);

    const phases = log.filter((e) => e.startsWith("C:")).map((e) => e.split(":")[1]);
    expect(phases).toEqual(["setup", "beforeUpdate", "update", "afterUpdate", "render"]);
  });

  it("teardown is called on engine.unuse()", async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder("D", log));
    await engine.unuse("D");
    expect(log).toContain("D:teardown");
  });

  it("plugin does not receive frame calls after unuse()", async () => {
    const engine = await createEngine();
    const log: string[] = [];
    await engine.use(makeRecorder("E", log));

    await engine.unuse("E");
    log.length = 0; // reset after teardown

    await engine.advance(0.016);
    expect(log).toHaveLength(0);
  });

  it("multiple plugins all receive frame calls in registration order", async () => {
    const engine = await createEngine();
    const updateOrder: string[] = [];

    await engine.use({
      name: "first",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          updateOrder.push("first");
        });
      },
    });
    await engine.use({
      name: "second",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          updateOrder.push("second");
        });
      },
    });
    await engine.use({
      name: "third",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          updateOrder.push("third");
        });
      },
    });

    await engine.advance(0.016);
    expect(updateOrder).toEqual(["first", "second", "third"]);
  });

  it("advance() accumulates frameCount correctly over multiple ticks", async () => {
    const engine = await createEngine();
    expect(engine.frameCount).toBe(0);

    await engine.advance(0.016);
    expect(engine.frameCount).toBe(1);

    await engine.advance(0.016);
    await engine.advance(0.016);
    expect(engine.frameCount).toBe(3);
  });

  it("dt is capped to maxDeltaSeconds * 1000 ms", async () => {
    const dts: number[] = [];
    const engine = await createEngine({ maxDeltaSeconds: 0.05 }); // cap = 50 ms

    await engine.use({
      name: "cap-check",
      setup(e) {
        e.hooks.hook("engine:update", (dt) => {
          dts.push(dt);
        });
      },
    });

    await engine.advance(10); // far above cap
    expect(dts[0]).toBe(0.05);
  });
});

// ─── startExternal() integration ─────────────────────────────────────────────

describe("Engine lifecycle — startExternal + advance", () => {
  it("startExternal() fires engine:init and engine:start hooks", async () => {
    const engine = await createEngine();
    const fired: string[] = [];

    engine.hooks.hook("engine:init", () => fired.push("init"));
    engine.hooks.hook("engine:start", () => fired.push("start"));

    await engine.startExternal();

    expect(fired).toContain("init");
    expect(fired).toContain("start");
  });

  it("plugins installed before startExternal() still receive frame calls", async () => {
    const engine = await createEngine();
    const calls: string[] = [];

    await engine.use({
      name: "pre-start",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          calls.push("update");
        });
      },
    });

    await engine.startExternal();
    await engine.advance(0.016);

    expect(calls).toContain("update");
  });

  it("plugins installed after startExternal() also receive frame calls", async () => {
    const engine = await createEngine();
    await engine.startExternal();

    const calls: string[] = [];
    await engine.use({
      name: "post-start",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          calls.push("update");
        });
      },
    });

    await engine.advance(0.016);
    expect(calls).toContain("update");
  });
});

// ─── provide / inject cross-plugin ───────────────────────────────────────────

describe("Engine lifecycle — provide / inject across plugins", () => {
  it("a plugin can provide a service that a second plugin injects during setup", async () => {
    const engine = await createEngine();

    // Plugin A provides a counter service
    await engine.use({
      name: "provider",
      setup(eng) {
        eng.provide("counter" as never, { count: 0 } as never);
      },
    });

    // Plugin B reads the service during its own setup
    let injectedCount: number | undefined;
    await engine.use({
      name: "consumer",
      setup(eng) {
        const svc = eng.tryInject("counter") as { count: number } | undefined;
        injectedCount = svc?.count;
      },
    });

    expect(injectedCount).toBe(0);
  });
});

// ─── stop() lifecycle ──────────────────────────────────────────────────────

describe("Engine lifecycle — stop()", () => {
  it("stop() calls disposables in reverse (LIFO) order", async () => {
    const engine = await createEngine();
    const order: number[] = [];

    (engine as any).disposables.add("first", {
      disposed: false,
      dispose: () => order.push(1),
      [Symbol.dispose]() {
        this.dispose();
      },
    });
    (engine as any).disposables.add("second", {
      disposed: false,
      dispose: () => order.push(2),
      [Symbol.dispose]() {
        this.dispose();
      },
    });
    (engine as any).disposables.add("third", {
      disposed: false,
      dispose: () => order.push(3),
      [Symbol.dispose]() {
        this.dispose();
      },
    });

    await engine.stop();

    expect(order).toEqual([3, 2, 1]);
  });

  it("stop() cancels the RAF/setTimeout frame handle — no zombie callbacks after stop", async () => {
    vi.useFakeTimers();
    const engine = await createEngine();

    // Stub RAF and setTimeout to count calls
    const rafCalls: Function[] = [];
    const timeoutCalls: Function[] = [];

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: Function) => {
        rafCalls.push(cb);
        return rafCalls.length;
      }),
    );
    vi.stubGlobal("clearTimeout", vi.fn());
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    // Track setTimeout (used as RAF fallback in some environments)
    vi.stubGlobal(
      "setTimeout",
      vi.fn((cb: Function) => {
        timeoutCalls.push(cb);
        return timeoutCalls.length as unknown as ReturnType<typeof setTimeout>;
      }),
    );

    await engine.start();
    const initialCallCount = rafCalls.length + timeoutCalls.length;
    expect(initialCallCount).toBeGreaterThan(0);

    await engine.stop();

    // After stop(), no more frame callbacks should be scheduled
    const afterStopCallCount = rafCalls.length + timeoutCalls.length;
    expect(afterStopCallCount).toBe(initialCallCount);

    // Verify cancelAnimationFrame or clearTimeout was called
    expect(
      vi.mocked(cancelAnimationFrame).mock.calls.length + vi.mocked(clearTimeout).mock.calls.length,
    ).toBeGreaterThan(0);

    vi.useRealTimers();
  });
});

// ─── Engine:tick / engine:afterTick hooks ─────────────────────────────────────

describe("Engine lifecycle — engine hooks fire during advance()", () => {
  it("engine:tick fires once per advance() call", async () => {
    const engine = await createEngine();
    let ticks = 0;
    engine.hooks.hook("engine:tick", () => ticks++);

    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(ticks).toBe(2);
  });

  it("engine:afterTick fires once per advance() call", async () => {
    const engine = await createEngine();
    let afterTicks = 0;
    engine.hooks.hook("engine:afterTick", () => afterTicks++);

    await engine.advance(0.016);
    await engine.advance(0.016);
    await engine.advance(0.016);

    expect(afterTicks).toBe(3);
  });

  it("engine:tick fires before plugin engine:update, engine:afterTick fires after", async () => {
    const engine = await createEngine();
    const order: string[] = [];

    engine.hooks.hook("engine:tick", () => order.push("tick"));
    engine.hooks.hook("engine:afterTick", () => order.push("afterTick"));

    await engine.use({
      name: "p",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          order.push("update");
        });
      },
    });

    await engine.advance(0.016);

    expect(order.indexOf("tick")).toBeLessThan(order.indexOf("update"));
    expect(order.indexOf("update")).toBeLessThan(order.indexOf("afterTick"));
  });
});
