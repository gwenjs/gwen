/**
 * RFC-001: engine.use / engine.unuse lifecycle tests
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  GwenError,
  type GwenConfigIssue,
  type GwenEngineBase,
  type GwenErrorPayload,
  type GwenLogEntry,
  type IGwenScope,
} from "@gwenjs/schema";
import { GwenContextError, getCurrentScope, useErrorReporter, useLogger } from "@gwenjs/kit";
import { definePlugin } from "@gwenjs/kit/plugin";
import {
  GwenEngineStateError,
  GwenPluginDependencyError,
  GwenPluginNotFoundError,
  onCleanup,
  useEngine,
  useHook,
  type GwenEngine,
  type GwenPlugin,
} from "../src/index";
import * as core from "../src/index";
import { createEngine as openEngine } from "../src/node";
import "./support/plugin-registry";

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
    s1: { readonly missing: true };
    "absent:svc": { readonly missing: true };
    "lc:alpha": { readonly n: number };
    "lc:beta": { readonly n: number };
    "lc:gamma": { readonly n: number };
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
      provides: ["testSvc"],
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
      provides: ["testSvc"],
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

function logCapture(): {
  entries: GwenLogEntry[];
  logger: { providers: [{ handle(entry: GwenLogEntry): void }] };
} {
  const entries: GwenLogEntry[] = [];
  return {
    entries,
    logger: {
      providers: [
        {
          handle(entry: GwenLogEntry): void {
            entries.push(entry);
          },
        },
      ],
    },
  };
}

describe("plugin setup scope", () => {
  it("useLogger in sync plugin setup writes under plugin:<name>", async () => {
    const captured = logCapture();
    const engine = await createEngine({ debug: true, logger: captured.logger });
    const plugin: GwenPlugin = {
      name: "audio",
      setup() {
        useLogger().info("x");
      },
    };
    const outcome = await rejected(engine, plugin);
    const tagged = captured.entries.filter(
      (entry) => entry.tag === "plugin:audio" && entry.message === "x",
    );
    expect(tagged).toEqual([
      expect.objectContaining({ level: "info", tag: "plugin:audio", message: "x" }),
    ]);
    expect(outcome).toBeUndefined();
  });

  it("useLogger after an await in plugin setup throws GwenContextError CORE:OUTSIDE_ENGINE_CONTEXT", async () => {
    const captured = logCapture();
    const engine = await createEngine({ debug: true, logger: captured.logger });
    let caught: unknown;
    const plugin: GwenPlugin = {
      name: "audio",
      async setup() {
        useLogger().info("sync");
        await Promise.resolve();
        try {
          useLogger();
        } catch (error: unknown) {
          caught = error;
        }
      },
    };
    const outcome = await rejected(engine, plugin);
    const tagged = captured.entries.filter(
      (entry) => entry.tag === "plugin:audio" && entry.message === "sync",
    );
    expect(tagged).toEqual([
      expect.objectContaining({ level: "info", tag: "plugin:audio", message: "sync" }),
    ]);
    expect(outcome).toBeUndefined();
    expect(caught instanceof GwenContextError).toBe(true);
    if (!(caught instanceof GwenContextError)) return;
    expect(caught.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
  });

  it("debug and info from useLogger are dropped when debug is false", async () => {
    const captured = logCapture();
    const engine = await createEngine({ debug: false, logger: captured.logger });
    const plugin: GwenPlugin = {
      name: "x",
      setup() {
        const log = useLogger();
        log.debug("d");
        log.info("i");
        log.warn("kept");
      },
    };
    const outcome = await rejected(engine, plugin);
    const tagged = captured.entries.filter((entry) => entry.tag === "plugin:x");
    expect(tagged).toEqual([
      expect.objectContaining({ level: "warn", tag: "plugin:x", message: "kept" }),
    ]);
    expect(outcome).toBeUndefined();
  });

  it("onCleanup in plugin setup runs on unuse()", async () => {
    const engine = await createEngine();
    const held: { scope: IGwenScope | null } = { scope: null };
    let ran = false;
    const outcome = await rejected(engine, {
      name: "audio",
      setup() {
        held.scope = getCurrentScope();
        onCleanup(() => {
          ran = true;
        });
      },
    });
    expect(outcome).toBeUndefined();
    expect(held.scope?.meta.type).toBe("plugin");
    expect(held.scope?.meta.name).toBe("audio");
    await engine.unuse("audio");
    expect(ran).toBe(true);
    expect(held.scope?.cleanupCount).toBe(0);
  });

  it("onCleanup in plugin setup runs on stop()", async () => {
    const engine = await createEngine();
    const held: { scope: IGwenScope | null } = { scope: null };
    let ran = false;
    const outcome = await rejected(engine, {
      name: "audio",
      setup() {
        held.scope = getCurrentScope();
        onCleanup(() => {
          ran = true;
        });
      },
    });
    expect(outcome).toBeUndefined();
    expect(held.scope?.meta.type).toBe("plugin");
    expect(held.scope?.meta.name).toBe("audio");
    await engine.stop();
    expect(ran).toBe(true);
    expect(held.scope?.cleanupCount).toBe(0);
  });

  it("useHook in plugin setup no longer fires after unuse()", async () => {
    const engine = await createEngine();
    const held: { scope: IGwenScope | null } = { scope: null };
    let calls = 0;
    const plugin: GwenPlugin = {
      name: "audio",
      setup() {
        held.scope = getCurrentScope();
        useHook("engine:update", () => {
          calls += 1;
        });
      },
    };
    const outcome = await rejected(engine, plugin);
    expect(outcome).toBeUndefined();
    expect(held.scope?.meta.type).toBe("plugin");
    expect(held.scope?.meta.name).toBe("audio");
    expect(held.scope?.hookCount).toBe(1);
    await engine.hooks.callHook("engine:update", 0);
    expect(calls).toBe(1);
    await engine.unuse("audio");
    await engine.hooks.callHook("engine:update", 0);
    expect(calls).toBe(1);
  });

  it("a failed setup disposes its scope", async () => {
    const engine = await createEngine();
    const held: { scope: IGwenScope | null } = { scope: null };
    let ran = false;
    const boom = new Error("setup failed");
    const plugin: GwenPlugin = {
      name: "audio",
      setup() {
        held.scope = getCurrentScope();
        onCleanup(() => {
          ran = true;
        });
        throw boom;
      },
    };
    const outcome = await rejected(engine, plugin);
    expect(outcome).toBe(boom);
    expect(held.scope?.meta.type).toBe("plugin");
    expect(held.scope?.meta.name).toBe("audio");
    expect(getCurrentScope()).toBeNull();
    expect(ran).toBe(true);
    expect(held.scope?.cleanupCount).toBe(0);
  });

  it("a throwing onCleanup during a failed setup keeps the setup error and still removes the plugin's hooks", async () => {
    const engine = await createEngine();
    const held: { scope: IGwenScope | null } = { scope: null };
    let calls = 0;
    const boom = new Error("boom");
    const cleanupError = new Error("e2");
    const plugin: GwenPlugin = {
      name: "audio",
      setup(setupEngine) {
        held.scope = getCurrentScope();
        onCleanup(() => {
          throw cleanupError;
        });
        setupEngine.hooks.hook("engine:update", () => {
          calls += 1;
        });
        throw boom;
      },
    };
    const outcome = await rejected(engine, plugin);
    expect(outcome).toBe(boom);
    await engine.hooks.callHook("engine:update", 0);
    expect(calls).toBe(0);
    expect(held.scope?.meta.type).toBe("plugin");
  });

  it("a setup that rejects after an await disposes its scope", async () => {
    const engine = await createEngine();
    const held: { scope: IGwenScope | null } = { scope: null };
    let ran = false;
    const boom = new Error("async setup failed");
    const plugin: GwenPlugin = {
      name: "audio",
      async setup() {
        held.scope = getCurrentScope();
        onCleanup(() => {
          ran = true;
        });
        await Promise.resolve();
        throw boom;
      },
    };
    const outcome = await rejected(engine, plugin);
    expect(outcome).toBe(boom);
    expect(ran).toBe(true);
    expect(getCurrentScope()).toBeNull();
    expect(held.scope?.meta.type).toBe("plugin");
    expect(held.scope?.cleanupCount).toBe(0);
  });

  it("two engines each give their plugins their own scope", async () => {
    const first = logCapture();
    const second = logCapture();
    const engineA = await createEngine({ debug: true, logger: first.logger });
    const engineB = await createEngine({ debug: true, logger: second.logger });
    const heldA: { scope: IGwenScope | null } = { scope: null };
    const heldB: { scope: IGwenScope | null } = { scope: null };
    const outcomeA = await rejected(engineA, {
      name: "audio",
      setup() {
        heldA.scope = getCurrentScope();
        useLogger().info("from-a");
      },
    });
    const outcomeB = await rejected(engineB, {
      name: "audio",
      setup() {
        heldB.scope = getCurrentScope();
        useLogger().info("from-b");
      },
    });
    expect(heldA.scope?.engine).not.toBe(heldB.scope?.engine);
    expect(heldA.scope?.engine.logger).toBe(engineA.logger);
    expect(heldB.scope?.engine.logger).toBe(engineB.logger);
    expect(
      first.entries.filter((entry) => entry.tag === "plugin:audio").map((entry) => entry.message),
    ).toEqual(["from-a"]);
    expect(
      second.entries.filter((entry) => entry.tag === "plugin:audio").map((entry) => entry.message),
    ).toEqual(["from-b"]);
    expect(outcomeA).toBeUndefined();
    expect(outcomeB).toBeUndefined();
  });

  it("a definePlugin setup error reaches the bus once as itself", async () => {
    const engine = await createEngine();
    const cause = new Error("x");
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const plugin = definePlugin(() => ({
      name: "boom",
      setup() {
        throw cause;
      },
    }))();
    const thrown = await rejected(engine, plugin);
    expect(thrown).toBe(cause);
    const setupEvents = events.filter((event) => event.code === "CORE:PLUGIN_SETUP_ERROR");
    expect(setupEvents).toHaveLength(1);
    expect(setupEvents[0]?.error).toBe(cause);
    expect(events.some((event) => event.code === "engine:plugin-setup-failed")).toBe(false);
  });

  it("useErrorReporter().report inside setup rejects use() with that GwenError", async () => {
    const engine = await createEngine();
    const cause = new Error("missing");
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    const plugin = definePlugin(() => ({
      name: "Reporter",
      setup() {
        useErrorReporter().report("KIT:X", "Missing API key.", cause);
      },
    }))();
    const thrown = await rejected(engine, plugin);
    expect(thrown).toBeInstanceOf(GwenError);
    if (!(thrown instanceof GwenError)) return;
    expect(thrown.code).toBe("KIT:X");
    expect(thrown.cause).toBe(cause);
    expect(events.map((event) => event.code)).toEqual(["CORE:PLUGIN_SETUP_ERROR"]);
    expect(events[0]?.error).toBe(thrown);
  });
});

describe("plugin options and provided keys", () => {
  const optionIssues: readonly GwenConfigIssue[] = [
    { path: "gravity", expected: "a finite number", received: "NaN", owner: "test" },
    { path: "layers", expected: "an array of numbers", received: '"x"', owner: "test" },
  ];

  function busEvents(engine: GwenEngine): GwenErrorPayload[] {
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    return events;
  }

  function serviceEvents(engine: GwenEngine): string[] {
    const events: string[] = [];
    engine.hooks.hook("service:provided", (notice) => {
      events.push(`provided:${String(notice.key)}`);
    });
    engine.hooks.hook("service:removed", (notice) => {
      events.push(`removed:${String(notice.key)}`);
    });
    return events;
  }

  it("use() with invalid options rejects CORE:PLUGIN_OPTIONS_INVALID listing every issue, setup not called, nothing on the bus", async () => {
    expect(typeof core.GwenPluginOptionsError).toBe("function");
    const engine = await createEngine();
    const events = busEvents(engine);
    let setups = 0;
    let registered = 0;
    engine.hooks.hook("plugin:registered", () => {
      registered += 1;
    });
    const plugin: GwenPlugin = {
      name: "Opts",
      validateOptions: () => optionIssues,
      setup() {
        setups += 1;
      },
    };
    const thrown = await rejected(engine, plugin);
    expect(thrown).toBeInstanceOf(core.GwenPluginOptionsError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_OPTIONS_INVALID",
      plugin: "Opts",
      issues: optionIssues,
    });
    expect(thrown).toHaveProperty("issues.length", 2);
    expect(thrown).toHaveProperty("issues.0.path", "gravity");
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain('"gravity" expected a finite number, received NaN');
    expect(message).toContain('"layers" expected an array of numbers, received "x"');
    expect(setups).toBe(0);
    expect(events).toEqual([]);
    expect(registered).toBe(0);
    expect(getCurrentScope()).toBeNull();
    expect(engine.getStats().plugins).toEqual([]);
  });

  it("use(B) declaring a key A owns rejects DUPLICATE with owner A", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    await engine.use({
      name: "A",
      provides: ["lc:alpha", "lc:beta"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
        host.provide("lc:beta", { n: 3 });
      },
    });
    const events = busEvents(engine);
    let setups = 0;
    const thrown = await rejected(engine, {
      name: "B",
      provides: ["lc:alpha", "lc:gamma", "lc:beta"],
      setup(host) {
        setups += 1;
        host.provide("lc:alpha", { n: 2 });
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_DUPLICATE",
      plugin: "B",
      keys: ["lc:alpha", "lc:beta"],
      owner: "A",
    });
    expect(setups).toBe(0);
    expect(engine.inject("lc:alpha")).toEqual({ n: 1 });
    expect(events).toEqual([]);
    expect(engine.getStats().plugins).toEqual(["A"]);
  });

  it("use(B) declaring logger rejects DUPLICATE with owner <engine>", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    let setups = 0;
    const thrown = await rejected(engine, {
      name: "B",
      provides: ["lc:alpha", "logger" as never],
      setup() {
        setups += 1;
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_DUPLICATE",
      plugin: "B",
      keys: ["logger"],
      owner: "<engine>",
    });
    expect(thrown instanceof Error ? thrown.message : "").toContain(
      "already provided by the engine",
    );
    expect(setups).toBe(0);
  });

  it("concurrent use(A) and use(B) declaring the same key: the second rejects DUPLICATE", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let secondSetups = 0;
    const first = engine.use({
      name: "A",
      provides: ["lc:alpha"],
      async setup(host) {
        await gate;
        host.provide("lc:alpha", { n: 1 });
      },
    });
    const second = engine.use({
      name: "B",
      provides: ["lc:alpha"],
      setup(host) {
        secondSetups += 1;
        host.provide("lc:alpha", { n: 2 });
      },
    });
    release();
    const settled = await Promise.allSettled([first, second]);
    expect(settled[0]?.status).toBe("fulfilled");
    expect(settled[1]?.status).toBe("rejected");
    const reason = settled[1]?.status === "rejected" ? settled[1].reason : undefined;
    expect(reason).toBeInstanceOf(core.GwenPluginProvideError);
    expect(reason).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_DUPLICATE",
      plugin: "B",
      keys: ["lc:alpha"],
      owner: "A",
    });
    expect(secondSetups).toBe(0);
    expect(engine.inject("lc:alpha")).toEqual({ n: 1 });
  });

  it("provide of an undeclared key in setup throws UNDECLARED and setup fails through the normal path", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const events = busEvents(engine);
    const announced = serviceEvents(engine);
    const thrown = await rejected(engine, {
      name: "U",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
        host.provide("lc:beta", { n: 2 });
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_UNDECLARED",
      plugin: "U",
      keys: ["lc:beta"],
      owner: null,
    });
    const setupEvents = events.filter((event) => event.code === "CORE:PLUGIN_SETUP_ERROR");
    expect(setupEvents).toHaveLength(1);
    expect(setupEvents[0]?.error).toBe(thrown);
    expect(engine.tryInject("lc:alpha")).toBeUndefined();
    expect(engine.tryInject("lc:beta")).toBeUndefined();
    expect(announced).toEqual([]);
    expect(engine.getStats().plugins).toEqual([]);
  });

  it("an undeclared provide after setup through the captured engine throws to the caller", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    let captured: GwenEngineBase | undefined;
    await engine.use({
      name: "Late",
      provides: ["lc:alpha"],
      setup(host) {
        captured = host;
        host.provide("lc:alpha", { n: 1 });
      },
    });
    let caught: unknown;
    try {
      captured?.provide("lc:beta", { n: 2 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(core.GwenPluginProvideError);
    expect(caught).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_UNDECLARED",
      plugin: "Late",
      keys: ["lc:beta"],
      owner: null,
    });
    expect(engine.tryInject("lc:beta")).toBeUndefined();
    expect(engine.inject("lc:alpha")).toEqual({ n: 1 });
  });

  it("setup resolving without a declared key rejects MISSING and the plugin is removed", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const events = busEvents(engine);
    let torn = 0;
    let hits = 0;
    const thrown = await rejected(engine, {
      name: "M",
      provides: ["lc:alpha", "lc:beta"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
        host.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
      teardown() {
        torn += 1;
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_MISSING",
      plugin: "M",
      keys: ["lc:beta"],
      owner: null,
    });
    expect(engine.tryInject("lc:alpha")).toBeUndefined();
    expect(torn).toBe(1);
    expect(events.filter((event) => event.code === "CORE:PLUGIN_SETUP_ERROR")).toEqual([]);
    expect(events).toEqual([]);
    expect(engine.getStats().plugins).toEqual([]);
    await engine.hooks.callHook("engine:update", 0);
    expect(hits).toBe(0);
  });

  it("a setup that misses a declared key announces nothing", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const announced = serviceEvents(engine);
    const thrown = await rejected(engine, {
      name: "M",
      provides: ["lc:alpha", "lc:beta"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(announced).toEqual([]);
  });

  it("unuse deletes exactly the declared keys", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    await engine.use({
      name: "Other",
      provides: ["lc:gamma"],
      setup(host) {
        host.provide("lc:gamma", { n: 9 });
      },
    });
    await engine.use({
      name: "Two",
      provides: ["lc:alpha", "lc:beta"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
        host.provide("lc:beta", { n: 2 });
      },
    });
    const announced = serviceEvents(engine);
    await engine.unuse("Two");
    expect(engine.tryInject("lc:alpha")).toBeUndefined();
    expect(engine.tryInject("lc:beta")).toBeUndefined();
    expect(engine.inject("lc:gamma")).toEqual({ n: 9 });
    expect(engine.tryInject("logger")).toBe(engine.logger);
    expect(announced).toEqual(["removed:lc:beta", "removed:lc:alpha"]);
    // The reservation is released: a new plugin may declare the keys again.
    await engine.use({
      name: "Again",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 5 });
      },
    });
    expect(engine.inject("lc:alpha")).toEqual({ n: 5 });
  });

  it("a raw GwenPlugin without provides may not provide", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const thrown = await rejected(engine, {
      name: "Raw",
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_UNDECLARED",
      plugin: "Raw",
      keys: ["lc:alpha"],
      owner: null,
    });
    expect(engine.tryInject("lc:alpha")).toBeUndefined();
  });

  it("provides: [] and no provide installs", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    await engine.use({ name: "Empty", provides: [], setup() {} });
    expect(engine.getStats().plugins).toEqual(["Empty"]);
  });

  it("one declared key that is provided installs and announces it once", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const announced = serviceEvents(engine);
    await engine.use({
      name: "One",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
      },
    });
    expect(engine.inject("lc:alpha")).toEqual({ n: 1 });
    expect(announced).toEqual(["provided:lc:alpha"]);
  });

  it("two declared keys with one missing: MISSING names only the missing one", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const thrown = await rejected(engine, {
      name: "Half",
      provides: ["lc:alpha", "lc:beta"],
      setup(host) {
        host.provide("lc:beta", { n: 2 });
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(thrown).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_MISSING",
      keys: ["lc:alpha"],
    });
  });

  it("the same plugin installs on two engines without DUPLICATE", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const first = await createEngine();
    const second = await createEngine();
    const plugin: GwenPlugin = {
      name: "Shared",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
      },
    };
    await first.use(plugin);
    await second.use(plugin);
    expect(first.getStats().plugins).toEqual(["Shared"]);
    expect(second.getStats().plugins).toEqual(["Shared"]);
    expect(first.inject("lc:alpha")).toEqual({ n: 1 });
    expect(second.inject("lc:alpha")).toEqual({ n: 1 });
  });

  it("use() after a MISSING rejection installs the fixed plugin", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const thrown = await rejected(engine, {
      name: "Fix",
      provides: ["lc:alpha"],
      setup() {},
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    await engine.use({
      name: "Fix",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 4 });
      },
    });
    expect(engine.inject("lc:alpha")).toEqual({ n: 4 });
    expect(engine.getStats().plugins).toEqual(["Fix"]);
  });

  it("MISSING with a throwing teardown clears the isolation: the fixed plugin keeps its setup-time hook", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const events = busEvents(engine);
    const failure = new Error("teardown-boom");
    const thrown = await rejected(engine, {
      name: "Iso",
      provides: ["lc:alpha"],
      setup() {},
      teardown() {
        throw failure;
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(events.filter((event) => event.error === failure)).toHaveLength(1);
    let hits = 0;
    await engine.use({
      name: "Iso",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 1 });
        host.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
    });
    await engine.hooks.callHook("engine:update", 0);
    expect(hits).toBe(1);
  });

  it("a setup that throws after a throwing onCleanup clears the isolation: the fixed plugin keeps its setup-time hook", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const events = busEvents(engine);
    const failure = new Error("c");
    const thrown = await rejected(engine, {
      name: "IsoSetup",
      setup() {
        onCleanup(() => {
          throw failure;
        });
        throw new Error("s");
      },
    });
    expect(thrown).toMatchObject({ message: "s" });
    expect(events.filter((event) => event.error === failure)).toHaveLength(1);
    let hits = 0;
    await engine.use({
      name: "IsoSetup",
      setup(host) {
        host.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
    });
    await engine.hooks.callHook("engine:update", 0);
    expect(hits).toBe(1);
  });

  it("a setup that throws runs its onCleanup inside the engine context", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const events = busEvents(engine);
    const seen: GwenEngine[] = [];
    await rejected(engine, {
      name: "CtxSetup",
      setup() {
        onCleanup(() => {
          seen.push(useEngine());
        });
        throw new Error("s");
      },
    });
    expect(seen).toHaveLength(1);
    expect(events.filter((event) => event.error instanceof GwenContextError)).toHaveLength(0);
  });

  it("MISSING runs the setup disposer and teardown inside the engine context", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    const seen: GwenEngine[] = [];
    const thrown = await rejected(engine, {
      name: "Ctx",
      provides: ["lc:alpha"],
      setup() {
        onCleanup(() => {
          seen.push(useEngine());
        });
      },
      teardown() {
        seen.push(useEngine());
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("a late provide through a proxy captured by a rolled-back MISSING install throws and leaks nothing", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    let captured: GwenEngineBase | undefined;
    const thrown = await rejected(engine, {
      name: "Late",
      provides: ["lc:alpha"],
      setup(host) {
        captured = host;
      },
    });
    expect(thrown).toBeInstanceOf(core.GwenPluginProvideError);
    let caught: unknown;
    try {
      captured?.provide("lc:alpha", { n: 1 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CORE:PLUGIN_PROVIDE_UNDECLARED",
      plugin: "Late",
      keys: ["lc:alpha"],
    });
    expect(engine.tryInject("lc:alpha")).toBeUndefined();
    await engine.use({
      name: "Late",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 2 });
      },
    });
    expect(engine.inject("lc:alpha")).toEqual({ n: 2 });
    // The stale proxy stays dead after the same name installs again.
    expect(() => captured?.provide("lc:alpha", { n: 3 })).toThrow(core.GwenPluginProvideError);
    expect(engine.inject("lc:alpha")).toEqual({ n: 2 });
  });

  it("a late provide after unuse throws and leaves the key free", async () => {
    expect(typeof core.GwenPluginProvideError).toBe("function");
    const engine = await createEngine();
    let captured: GwenEngineBase | undefined;
    await engine.use({
      name: "Gone",
      provides: ["lc:alpha"],
      setup(host) {
        captured = host;
        host.provide("lc:alpha", { n: 1 });
      },
    });
    await engine.unuse("Gone");
    expect(() => captured?.provide("lc:alpha", { n: 2 })).toThrow(core.GwenPluginProvideError);
    expect(engine.tryInject("lc:alpha")).toBeUndefined();
    await engine.use({
      name: "Next",
      provides: ["lc:alpha"],
      setup(host) {
        host.provide("lc:alpha", { n: 3 });
      },
    });
    expect(engine.inject("lc:alpha")).toEqual({ n: 3 });
  });
});
