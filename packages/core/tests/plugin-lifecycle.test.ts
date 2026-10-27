/**
 * RFC-001: engine.use / engine.unuse lifecycle tests
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { GwenError } from "@gwenjs/schema";
import {
  createEngine as openEngine,
  GwenEngineStateError,
  GwenPluginNotFoundError,
  type GwenEngine,
  type GwenPlugin,
} from "../src/index";

const engines: GwenEngine[] = [];

async function createEngine(...args: Parameters<typeof openEngine>): Promise<GwenEngine> {
  const engine = await openEngine(...args);
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

declare module "@gwenjs/schema" {
  interface GwenProvides {
    testSvc: { value: number };
  }
}

describe("engine.use / engine.unuse", () => {
  it("calls setup with engine instance", async () => {
    const engine = await createEngine();
    const setup = vi.fn();
    await engine.use({ name: "P", setup });
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ use: expect.any(Function) }));
  });

  it("awaits async setup before resolving", async () => {
    const engine = await createEngine();
    let resolved = false;
    await engine.use({
      name: "Async",
      async setup() {
        await new Promise<void>((r) => setTimeout(r, 10));
        resolved = true;
      },
    });
    expect(resolved).toBe(true);
  });

  it("calls teardown on unuse()", async () => {
    const engine = await createEngine();
    const teardown = vi.fn();
    await engine.use({ name: "T", setup() {}, teardown });
    await engine.unuse("T");
    expect(teardown).toHaveBeenCalledOnce();
  });

  it("unuse() unknown name is a no-op", async () => {
    const engine = await createEngine();
    await expect(engine.unuse("Unknown")).resolves.toBeUndefined();
  });

  it("all 4 frame hooks called in order", async () => {
    const calls: string[] = [];
    const engine = await createEngine();
    await engine.use({
      name: "Hooks",
      setup(e) {
        e.hooks.hook("engine:before-update", () => {
          calls.push("before");
        });
        e.hooks.hook("engine:update", () => {
          calls.push("update");
        });
        e.hooks.hook("engine:after-update", () => {
          calls.push("after");
        });
        e.hooks.hook("engine:render", () => {
          calls.push("render");
        });
      },
    });
    await engine.advance(1 / 60);
    expect(calls).toEqual(["before", "update", "after", "render"]);
  });

  it("use() rejects CORE:PLUGIN_DEPENDENCY_MISSING when a required plugin is absent and never calls setup", async () => {
    const engine = await createEngine();
    let setups = 0;
    let registered = 0;
    let reported = 0;
    engine.hooks.hook("plugin:registered", () => {
      registered += 1;
    });
    engine.errors.on(() => {
      reported += 1;
    });
    const setup = (host: GwenEngine): void => {
      setups += 1;
      host.provide("testSvc", { value: 1 });
    };
    const plugin: GwenPlugin = {
      name: "A",
      requires: { plugins: ["B"] },
      setup,
    };
    await expect(engine.use(plugin)).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      plugin: "A",
      missing: [{ kind: "plugin", name: "B" }],
      dependents: [],
    });
    expect(setups).toBe(0);
    expect(registered).toBe(0);
    expect(reported).toBe(0);
    expect(() => engine.inject("testSvc")).toThrow(GwenPluginNotFoundError);
  });

  it("use() returns a rejected promise when requires.plugins is not an array", async () => {
    const engine = await createEngine();
    const plugin: GwenPlugin = {
      ...(JSON.parse('{"name":"A","requires":{"plugins":"B"}}') as GwenPlugin),
      setup() {},
    };
    let pending: Promise<void> | undefined;
    expect(() => (pending = engine.use(plugin))).not.toThrow();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toThrow();
  });

  it("missing lists plugins first then services, in declaration order", async () => {
    const engine = await createEngine();
    const plugin: GwenPlugin = {
      name: "A",
      requires: { services: ["s1"], plugins: ["p2", "p1"] },
      setup() {},
    };
    await expect(engine.use(plugin)).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      missing: [
        { kind: "plugin", name: "p2" },
        { kind: "plugin", name: "p1" },
        { kind: "service", name: "s1" },
      ],
    });
  });

  it("engine-owned keys count as installed services; only the absent key is missing", async () => {
    const engine = await createEngine();
    const plugin: GwenPlugin = {
      name: "A",
      requires: { services: ["wasm:bridge", "logger", "errors", "memory", "absent:svc"] },
      setup() {},
    };
    await expect(engine.use(plugin)).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      missing: [{ kind: "service", name: "absent:svc" }],
    });
  });

  it("use(B) then use(A) installs both, and use(A) after a failed use(A) succeeds", async () => {
    const engine = await createEngine();
    const ran: string[] = [];
    const pluginA: GwenPlugin = {
      name: "A",
      requires: { plugins: ["B"] },
      setup() {
        ran.push("A");
      },
    };
    await expect(engine.use(pluginA)).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      missing: [{ kind: "plugin", name: "B" }],
    });
    await engine.use({
      name: "B",
      setup() {
        ran.push("B");
      },
    });
    await engine.use(pluginA);
    expect(ran).toEqual(["B", "A"]);
  });

  it("a requirement still installing counts as missing", async () => {
    const engine = await createEngine();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let setups = 0;
    const pending = engine.use({
      name: "B",
      setup() {
        return gate;
      },
    });
    try {
      await expect(
        engine.use({
          name: "A",
          requires: { plugins: ["B"] },
          setup() {
            setups += 1;
          },
        }),
      ).rejects.toMatchObject({
        code: "CORE:PLUGIN_DEPENDENCY_MISSING",
        missing: [{ kind: "plugin", name: "B" }],
      });
      expect(setups).toBe(0);
    } finally {
      release();
      await pending;
    }
  });

  it.runIf(__GWEN_DEV__)(
    "duplicate use() warns once with debug and stays silent without it",
    async () => {
      const text = '[GWEN] plugin "P" is already installed; duplicate use() ignored.';
      async function warnsFor(debug: boolean): Promise<string[]> {
        const warns: string[] = [];
        const engine = await createEngine({
          debug,
          logger: {
            providers: [
              {
                handle(entry) {
                  if (entry.level === "warn") warns.push(entry.message);
                },
              },
            ],
          },
        });
        let setups = 0;
        const plugin: GwenPlugin = {
          name: "P",
          setup() {
            setups += 1;
          },
        };
        await engine.use(plugin);
        await engine.use(plugin);
        expect(setups).toBe(1);
        return warns;
      }
      expect(await warnsFor(true)).toEqual([text]);
      expect(await warnsFor(false)).toEqual([]);
    },
  );

  it("two concurrent use() calls with one name run setup once and settle alike", async () => {
    const rejecting = await createEngine();
    let rejectedSetups = 0;
    const failing: GwenPlugin = {
      name: "P",
      async setup() {
        rejectedSetups += 1;
        await Promise.resolve();
        throw new Error("boom");
      },
    };
    const first = rejecting.use(failing);
    const second = rejecting.use(failing);
    const settled = await Promise.allSettled([first, second]);
    expect(rejectedSetups).toBe(1);
    expect(settled[0]?.status).toBe("rejected");
    expect(settled[1]?.status).toBe("rejected");
    if (settled[0]?.status === "rejected" && settled[1]?.status === "rejected") {
      expect(settled[1].reason).toBe(settled[0].reason);
    }

    const resolving = await createEngine();
    let resolvedSetups = 0;
    const ok: GwenPlugin = {
      name: "Q",
      async setup() {
        resolvedSetups += 1;
        await Promise.resolve();
      },
    };
    const left = resolving.use(ok);
    const right = resolving.use(ok);
    await Promise.all([left, right]);
    expect(resolvedSetups).toBe(1);
  });

  it("use() after stop() rejects GwenEngineStateError before the requirement check", async () => {
    const engine = await createEngine();
    await engine.stop();
    let setups = 0;
    const plugin: GwenPlugin = {
      name: "A",
      requires: { plugins: ["B"] },
      setup() {
        setups += 1;
      },
    };
    await expect(engine.use(plugin)).rejects.toBeInstanceOf(GwenEngineStateError);
    expect(setups).toBe(0);
  });

  it("requires boundaries: empty lists install, one absent name rejects", async () => {
    const open = await createEngine();
    let openRan = false;
    await open.use({
      name: "A",
      requires: {},
      setup() {
        openRan = true;
      },
    });
    expect(openRan).toBe(true);

    const blank = await createEngine();
    let blankRan = false;
    await blank.use({
      name: "A",
      requires: { plugins: [] },
      setup() {
        blankRan = true;
      },
    });
    expect(blankRan).toBe(true);

    const blocked = await createEngine();
    let blockedRan = false;
    await expect(
      blocked.use({
        name: "A",
        requires: { plugins: ["B"] },
        setup() {
          blockedRan = true;
        },
      }),
    ).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      missing: [{ kind: "plugin", name: "B" }],
    });
    expect(blockedRan).toBe(false);
  });

  it("a plugin installed on another engine does not satisfy a requirement", async () => {
    const first = await createEngine();
    const second = await createEngine();
    await first.use({ name: "B", setup() {} });
    let setups = 0;
    await expect(
      second.use({
        name: "A",
        requires: { plugins: ["B"] },
        setup() {
          setups += 1;
        },
      }),
    ).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      missing: [{ kind: "plugin", name: "B" }],
    });
    expect(setups).toBe(0);
  });

  it("a plugin requiring camera-core rejects CORE:PLUGIN_DEPENDENCY_MISSING on a headless engine", async () => {
    const engine = await createEngine();
    let setups = 0;
    await expect(
      engine.use({
        name: "A",
        requires: { plugins: ["camera-core"] },
        setup() {
          setups += 1;
        },
      }),
    ).rejects.toMatchObject({
      code: "CORE:PLUGIN_DEPENDENCY_MISSING",
      missing: [{ kind: "plugin", name: "camera-core" }],
    });
    expect(setups).toBe(0);
  });
});

describe("engine.provide / inject / tryInject", () => {
  it("inject() returns provided value", async () => {
    const engine = await createEngine();
    engine.provide("testSvc" as never, { value: 42 } as never);
    expect(engine.inject("testSvc" as never)).toEqual({ value: 42 });
  });

  it("inject() throws GwenPluginNotFoundError when absent", async () => {
    const engine = await createEngine();
    try {
      expect(() => engine.inject("testSvc" as never)).toThrow(GwenPluginNotFoundError);
    } finally {
      await engine.stop();
    }
  });

  it("GwenPluginNotFoundError has plugin, hint, docsUrl", async () => {
    const engine = await createEngine();
    try {
      engine.inject("testSvc" as never);
    } catch (e) {
      expect(e).toBeInstanceOf(GwenPluginNotFoundError);
      if (!(e instanceof GwenPluginNotFoundError)) return;
      expect(e.pluginName).toBe("testSvc");
      expect(e.docsUrl).toBe("https://gwenjs.github.io/gwen/api/errors#core-plugin-not-found");
      if (__GWEN_DEV__) expect(e.hint).toContain('provides: ["testSvc"]');
      else expect(e.hint).toBeUndefined();
    } finally {
      await engine.stop();
    }
  });

  it("tryInject() returns undefined when absent", async () => {
    const engine = await createEngine();
    expect(engine.tryInject("testSvc" as never)).toBeUndefined();
  });
});

describe("engine.advance()", () => {
  it("caps delta time at maxDeltaSeconds", async () => {
    const dts: number[] = [];
    const engine = await createEngine({ maxDeltaSeconds: 0.05 });
    await engine.use({
      name: "dt",
      setup(e) {
        e.hooks.hook("engine:update", (dt) => {
          dts.push(dt);
        });
      },
    });
    await engine.advance(1); // 1s > maxDeltaSeconds cap of 0.05s
    expect(dts[0]).toBe(0.05); // capped to maxDeltaSeconds
  });

  it("throws on re-entrant advance()", async () => {
    const engine = await createEngine();
    let secondCallError: unknown = null;
    await engine.use({
      name: "reentrant",
      setup(e) {
        e.hooks.hook("engine:update", () => {
          engine.advance(0.016).catch((caught: unknown) => {
            secondCallError = caught;
          });
        });
      },
    });
    try {
      await engine.advance(0.016);
      expect(secondCallError).toBeInstanceOf(GwenError);
      if (!(secondCallError instanceof GwenError)) return;
      expect(secondCallError.composable).toBe("engine.advance");
      expect(secondCallError.message).toContain("re-entrantly");
    } finally {
      await engine.stop();
    }
  });
});
