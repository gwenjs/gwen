/**
 * RFC-001: engine.use / engine.unuse lifecycle tests
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { GwenError, type GwenLogEntry } from "@gwenjs/schema";
import {
  createEngine as openEngine,
  GwenEngineStateError,
  GwenPluginDependencyError,
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

  it("unuse() of a required plugin rejects CORE:PLUGIN_IN_USE and keeps it", async () => {
    const engine = await createEngine();
    const torn: string[] = [];
    let hits = 0;
    await engine.use({
      name: "B",
      setup(host) {
        host.provide("testSvc", { value: 1 });
        host.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
      teardown() {
        torn.push("B");
      },
    });
    await engine.use({
      name: "A",
      requires: { plugins: ["B"] },
      setup() {},
    });
    let caught: unknown;
    try {
      await engine.unuse("B");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenPluginDependencyError);
    if (!(caught instanceof GwenPluginDependencyError)) return;
    expect(caught.code).toBe("CORE:PLUGIN_IN_USE");
    expect([...caught.dependents]).toEqual(["A"]);
    expect(caught.message.split("\n")[0]).toBe(
      '[engine.unuse()] Cannot unuse "B": required by "A".',
    );
    expect(torn).toEqual([]);
    expect(engine.inject("testSvc")).toEqual({ value: 1 });
    await engine.hooks.callHook("engine:update", 0);
    expect(hits).toBe(1);
    await expect(engine.unuse("A")).resolves.toBeUndefined();
    await expect(engine.unuse("B")).resolves.toBeUndefined();
  });

  it("unuse() of a plugin whose service another plugin requires rejects CORE:PLUGIN_IN_USE", async () => {
    const engine = await createEngine();
    await engine.use({
      name: "B",
      setup(host) {
        host.provide("testSvc", { value: 2 });
      },
    });
    await engine.use({
      name: "A",
      requires: { services: ["testSvc"] },
      setup() {},
    });
    await expect(engine.unuse("B")).rejects.toMatchObject({
      code: "CORE:PLUGIN_IN_USE",
      plugin: "B",
      dependents: ["A"],
    });
    expect(engine.inject("testSvc")).toEqual({ value: 2 });
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

type ShapePlugin = GwenPlugin & {
  onBeforeUpdate?: (dt: number) => void;
  onUpdate?: (dt: number) => void;
  onAfterUpdate?: (dt: number) => void;
  onRender?: () => void;
  onStart?: () => void;
  onStop?: () => void;
  onDestroy?: () => void;
  version?: number;
  _discover?: () => void;
  _pause?: () => void;
  toString?: () => string;
};

const FORBIDDEN_KEYS = [
  ["onBeforeUpdate", "engine:before-update"],
  ["onUpdate", "engine:update"],
  ["onAfterUpdate", "engine:after-update"],
  ["onRender", "engine:render"],
  ["onStart", "engine:start"],
  ["onStop", "engine:stop"],
  ["onDestroy", "engine:stop"],
] as const;

function firstLine(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : "";
}

function hintOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("hint" in error)) return undefined;
  const hint = error.hint;
  return typeof hint === "string" ? hint : undefined;
}

async function rejected(engine: GwenEngine, plugin: GwenPlugin): Promise<unknown> {
  return engine.use(plugin).then(
    () => undefined,
    (error: unknown) => error,
  );
}

function warnLogger(warns: string[]) {
  return {
    providers: [
      {
        handle(entry: GwenLogEntry) {
          if (entry.level === "warn") warns.push(entry.message);
        },
      },
    ],
  };
}

function plugged(name: string, tick: { n: number }, extra?: Partial<ShapePlugin>): ShapePlugin {
  const plugin: ShapePlugin = {
    name,
    setup() {
      tick.n += 1;
    },
  };
  return Object.assign(plugin, extra);
}

const versionLine = (name: string): string =>
  `[GWEN] plugin "${name}": unknown key "version" is ignored.`;

it("use() rejects a plugin with onRender with CORE:PLUGIN_INVALID_SHAPE and calls nothing", async () => {
  const engine = await createEngine();
  const bus: string[] = [];
  const registered: string[] = [];
  engine.errors.on((event) => {
    bus.push(event.code);
  });
  engine.hooks.hook("plugin:registered", (name) => {
    registered.push(name);
  });
  const tick = { n: 0 };
  const caught = await rejected(engine, plugged("x", tick, { onRender() {} }));
  expect(caught).toMatchObject({
    code: "CORE:PLUGIN_INVALID_SHAPE",
    plugin: "x",
    keys: ["onRender"],
  });
  expect(firstLine(caught)).toBe(
    '[engine.use()] Plugin "x" declares onRender, which the engine never calls; in setup(), hook engine:render for onRender.',
  );
  expect(tick.n).toBe(0);
  expect(bus).toEqual([]);
  expect(registered).toEqual([]);
  const again = { n: 0 };
  await engine.use(plugged("x", again));
  expect(again.n).toBe(1);
});

it("two forbidden keys give one error naming both hooks", async () => {
  const engine = await createEngine();
  const tick = { n: 0 };
  const caught = await rejected(engine, plugged("both", tick, { onUpdate() {}, onDestroy() {} }));
  expect(caught).toMatchObject({
    code: "CORE:PLUGIN_INVALID_SHAPE",
    keys: ["onUpdate", "onDestroy"],
  });
  expect(firstLine(caught)).toBe(
    '[engine.use()] Plugin "both" declares onUpdate, onDestroy, which the engine never calls; in setup(), hook engine:update for onUpdate and engine:stop for onDestroy.',
  );
  expect(tick.n).toBe(0);
});

it.each(FORBIDDEN_KEYS)("each of the 7 forbidden keys is rejected", async (key, hook) => {
  const engine = await createEngine();
  const plugin: ShapePlugin = { name: key, setup() {} };
  Object.assign(plugin, { [key]: () => {} });
  const caught = await rejected(engine, plugin);
  expect(caught).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE", keys: [key] });
  expect(firstLine(caught)).toContain(hook);
});

it("a nameless plugin is reported as <anonymous>", async () => {
  const engine = await createEngine();
  const plugin: ShapePlugin = { name: "temp", setup() {}, onRender() {} };
  Object.assign(plugin, { name: 1 });
  const caught = await rejected(engine, plugin);
  expect(caught).toMatchObject({
    code: "CORE:PLUGIN_INVALID_SHAPE",
    plugin: "<anonymous>",
    keys: ["onRender"],
  });
});

it("the shape check runs before the duplicate and requires checks", async () => {
  const engine = await createEngine();
  await engine.use({ name: "dup", setup() {} });
  const late = { n: 0 };
  const duplicateError = await rejected(engine, plugged("dup", late, { onUpdate() {} }));
  expect(duplicateError).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE" });
  expect(late.n).toBe(0);
  const need = { n: 0 };
  const missing = plugged("need", need, { requires: { plugins: ["missing"] }, onRender() {} });
  const missingError = await rejected(engine, missing);
  expect(missingError).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE" });
  expect(need.n).toBe(0);
});

it("the state gate runs before the shape check", async () => {
  const engine = await createEngine();
  const tick = { n: 0 };
  const plugin = plugged("late", tick, { onRender() {} });
  const running = await rejected(engine, plugin);
  expect(running).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE", keys: ["onRender"] });
  expect(tick.n).toBe(0);
  await engine.stop();
  const stopped = await rejected(engine, plugin);
  expect(stopped).toMatchObject({
    code: "CORE:INVALID_STATE_TRANSITION",
    from: "stopped",
    method: "use",
  });
  expect(tick.n).toBe(0);
});

it("the shape check runs in prod too", async () => {
  const warns: string[] = [];
  const engine = await createEngine({ debug: true, logger: warnLogger(warns) });
  const plugin: ShapePlugin = { name: "prod", setup() {}, onStart() {} };
  const caught = await rejected(engine, plugin);
  expect(caught).toMatchObject({
    code: "CORE:PLUGIN_INVALID_SHAPE",
    plugin: "prod",
    keys: ["onStart"],
  });
  const phrase = ["the hook table is ", "GWEN_PLUGIN_LIFECYCLE_HOOKS"].join("");
  if (__GWEN_DEV__) {
    expect(hintOf(caught)).toEqual(expect.stringContaining(phrase));
  } else {
    expect(hintOf(caught)).toBeUndefined();
    expect(caught instanceof Error ? caught.message : "").not.toContain("Fix:");
    const tick = { n: 0 };
    const before = warns.length;
    await engine.use(plugged("ver", tick, { version: 1 }));
    expect(warns.slice(before)).toEqual([]);
    expect(tick.n).toBe(1);
    const shaped: ShapePlugin = { name: "both-prod", setup() {}, version: 1, onRender() {} };
    const shapeCaught = await rejected(engine, shaped);
    expect(shapeCaught).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE", keys: ["onRender"] });
    expect(warns).toEqual([]);
  }
});

it.runIf(__GWEN_DEV__)("an unknown key warns once in dev with debug and installs", async () => {
  const warns: string[] = [];
  const engine = await createEngine({ debug: true, logger: warnLogger(warns) });
  const tick = { n: 0 };
  const before = warns.length;
  await engine.use(plugged("p", tick, { version: 1 }));
  expect(warns.slice(before)).toEqual([versionLine("p")]);
  expect(tick.n).toBe(1);
});

it("no unknown-key warning without debug", async () => {
  const warns: string[] = [];
  const engine = await createEngine({ debug: false, logger: warnLogger(warns) });
  const tick = { n: 0 };
  const before = warns.length;
  await engine.use(plugged("p", tick, { version: 1 }));
  expect(warns.slice(before)).toEqual([]);
  expect(tick.n).toBe(1);
  if (__GWEN_DEV__) {
    const debugWarns: string[] = [];
    const debugEngine = await createEngine({ debug: true, logger: warnLogger(debugWarns) });
    const debugTick = { n: 0 };
    await debugEngine.use(plugged("p-debug", debugTick, { version: 1 }));
    expect(debugWarns).toEqual([versionLine("p-debug")]);
    expect(debugTick.n).toBe(1);
  } else {
    const shaped: ShapePlugin = { name: "p-shape", setup() {}, version: 1, onRender() {} };
    const caught = await rejected(engine, shaped);
    expect(caught).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE", keys: ["onRender"] });
  }
});

it("_-prefixed and requires keys never warn", async () => {
  const warns: string[] = [];
  const engine = await createEngine({ debug: true, logger: warnLogger(warns) });
  const tick = { n: 0 };
  const marked = plugged("marked", tick, {
    teardown() {},
    onError() {},
    requires: { plugins: [] },
    _discover() {},
    _pause() {},
  });
  const before = warns.length;
  await engine.use(plugged("plain", tick));
  await engine.use(marked);
  if (__GWEN_DEV__) {
    await engine.use(plugged("extra", tick, { version: 1 }));
    expect(warns.slice(before)).toEqual([versionLine("extra")]);
    expect(tick.n).toBe(3);
  } else {
    const shaped: ShapePlugin = { name: "extra", setup() {}, version: 1, onRender() {} };
    const caught = await rejected(engine, shaped);
    expect(caught).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE", keys: ["onRender"] });
    expect(warns.slice(before)).toEqual([]);
    expect(tick.n).toBe(2);
  }
});

it("an own key named like an Object.prototype member is not a lifecycle key", async () => {
  const warns: string[] = [];
  const engine = await createEngine({ debug: false, logger: warnLogger(warns) });
  const toStringTick = { n: 0 };
  const constructorTick = { n: 0 };
  const before = warns.length;
  await rejected(engine, plugged("p-toString", toStringTick, { toString: () => "x" }));
  const constructorPlugin = plugged("p-constructor", constructorTick);
  Object.assign(constructorPlugin, { constructor: () => "y" });
  await rejected(engine, constructorPlugin);
  expect(toStringTick.n).toBe(1);
  expect(constructorTick.n).toBe(1);
  expect(warns.slice(before)).toEqual([]);
  const caught = await rejected(engine, plugged("p-render", { n: 0 }, { onRender() {} }));
  expect(caught).toMatchObject({ code: "CORE:PLUGIN_INVALID_SHAPE", keys: ["onRender"] });
});
