import { afterEach, describe, expect, it } from "vitest";
import { definePlugin, optionalService, watchService } from "@gwenjs/kit/plugin";
import type { GwenEngineBase, GwenPluginRequires, GwenPluginServiceKey } from "@gwenjs/schema";
import type { GwenEngine, GwenPlugin } from "../../src/engine/engine-types.js";
import { hotReplacePlugin, type GwenHotReport } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { defineSystem, onUpdate } from "../../src/system/runtime/define-system";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p783:svc": { readonly n: number };
  }
  interface GwenPluginRegistry {
    Local: {};
    NotHere: {};
  }
}

const engines: GwenEngine[] = [];
const stopWatching: Array<() => void> = [];
const noServices: readonly GwenPluginServiceKey[] = [];

async function boot(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const stop of stopWatching.splice(0)) stop();
  for (const engine of engines.splice(0)) await engine.stop();
});

/** A plugin that provides `p783:svc` with `n`, logging its setup and teardown. */
function provider(
  n: number,
  log: string[],
  tag: string,
  teardown?: () => Promise<void>,
  name = "Local",
): GwenPlugin {
  return definePlugin({ provides: ["p783:svc"] }, () => ({
    name,
    setup(host: GwenEngineBase) {
      log.push(`${tag} setup`);
      host.provide("p783:svc", { n });
    },
    async teardown() {
      log.push(`${tag} teardown start`);
      await teardown?.();
      log.push(`${tag} teardown end`);
    },
  }))();
}

function consumer(
  name: string,
  requires: GwenPluginRequires,
  setup: (host: GwenEngineBase) => void = () => {},
): GwenPlugin {
  return definePlugin({ provides: noServices }, () => ({
    name,
    requires,
    setup,
  }))();
}

function throwingSetup(): GwenPlugin {
  return definePlugin({ provides: noServices }, () => ({
    name: "Local",
    setup() {
      throw new Error("setup failed");
    },
  }))();
}

function missingDependency(): GwenPlugin {
  return definePlugin({ provides: noServices }, () => ({
    name: "Local",
    requires: { plugins: ["NotHere"] },
    setup() {},
  }))();
}

interface BusNote {
  readonly code: string;
  readonly phase: unknown;
}

function watchErrors(engine: GwenEngine, notes: BusNote[]): void {
  stopWatching.push(
    engine.errors.on((event) => {
      notes.push({ code: event.code, phase: event.context?.["phase"] });
    }),
  );
}

/** A plugin with no service. Setup and teardown append `name` to `log`. */
function plain(name: string, log: string[]): GwenPlugin {
  return definePlugin({ provides: noServices }, () => ({
    name,
    setup() {
      log.push(`${name} setup`);
    },
    teardown() {
      log.push(`${name} teardown`);
    },
  }))();
}

const applied = (name: string, count: number): GwenHotReport => ({
  status: "applied",
  kind: "plugin",
  name,
  count,
});

describe.runIf(__GWEN_DEV__)("hotReplacePlugin", () => {
  it("teardown of the previous plugin completes before the new setup starts", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(
      provider(1, log, "old", async () => {
        await Promise.resolve();
        await Promise.resolve();
      }),
    );
    log.length = 0;

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual(applied("Local", 1));
    expect(log).toEqual(["old teardown start", "old teardown end", "new setup"]);
  });

  it("a plain plugin that requires a service of the swapped plugin reports plugin-in-use and removes nothing", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.use(consumer("Hard", { services: ["p783:svc"] }));
    log.length = 0;

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual({
      status: "reload",
      kind: "plugin",
      name: "Local",
      reason: "plugin-in-use",
      detail: "Hard",
    });
    expect(log).toEqual([]);
    expect(engine.getStats().plugins).toEqual(["Local", "Hard"]);
    expect(engine.inject("p783:svc")).toEqual({ n: 1 });
  });

  it("a plugin that requires the swapped plugin by name reports plugin-in-use and removes nothing", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.use(consumer("Layered", { plugins: ["Local"] }));
    log.length = 0;

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual({
      status: "reload",
      kind: "plugin",
      name: "Local",
      reason: "plugin-in-use",
      detail: "Layered",
    });
    expect(log).toEqual([]);
    expect(engine.getStats().plugins).toEqual(["Local", "Layered"]);
  });

  it("the re-installed plugin is last in install order", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.use(consumer("After", {}));

    await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(engine.getStats().plugins).toEqual(["After", "Local"]);
  });

  it("a re-created memory view with the same name does not throw", async () => {
    const engine = await boot();
    const views: Array<{ dispose(): void }> = [];
    const withView = (): GwenPlugin =>
      definePlugin({ provides: noServices }, () => ({
        name: "Viewer",
        setup() {
          views.push(
            engine.memory.view({ name: "p783:view", type: "u8", ptr: () => 0, length: () => 1 }),
          );
        },
        teardown() {
          views.at(-1)?.dispose();
        },
      }))();
    await engine.use(withView());

    const report = await hotReplacePlugin(engine, "Viewer", withView());

    expect(report).toEqual(applied("Viewer", 1));
    expect(views).toHaveLength(2);
    expect(engine.getStats().plugins).toEqual(["Viewer"]);
  });

  it("a soft consumer sees removed then provided with reason hot-replace and ends with the new value", async () => {
    const engine = await boot();
    const log: string[] = [];
    const events: string[] = [];
    let ref: { readonly current: { readonly n: number } | undefined } | undefined;
    await engine.use(provider(1, log, "old"));
    await engine.use(
      consumer("Soft", { optional: ["p783:svc"] }, (host) => {
        ref = optionalService(host, "p783:svc");
        host.hooks.hook("service:removed", (e) => {
          events.push(`removed:${e.reason}`);
        });
        host.hooks.hook("service:provided", (e) => {
          events.push(`provided:${e.reason}`);
        });
      }),
    );

    await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(events).toEqual(["removed:hot-replace", "provided:hot-replace"]);
    expect(ref?.current).toEqual({ n: 2 });
  });

  it("a soft consumer does not block the swap", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.use(consumer("Soft", { optional: ["p783:svc"] }));

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual(applied("Local", 1));
    expect(engine.getStats().plugins).toEqual(["Soft", "Local"]);
  });

  it("during the swap gap the soft consumer reads undefined", async () => {
    const engine = await boot();
    const log: string[] = [];
    const seen: Array<number | undefined> = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await engine.use(provider(1, log, "old", () => gate));
    let ref: { readonly current: { readonly n: number } | undefined } | undefined;
    await engine.use(
      consumer("Soft", { optional: ["p783:svc"] }, (host) => {
        ref = optionalService(host, "p783:svc");
      }),
    );
    const Probe = defineSystem("probe", () => {
      onUpdate(() => {
        seen.push(ref?.current?.n);
      });
    });
    await engine.use(Probe());

    const swap = hotReplacePlugin(engine, "Local", provider(2, log, "new"));
    await Promise.resolve();
    await engine.advance(0.016);
    release?.();
    await swap;
    await engine.advance(0.016);

    expect(seen).toEqual([undefined, 2]);
  });

  it("50 swaps leave the consumer's listener count unchanged", async () => {
    const engine = await boot();
    const log: string[] = [];
    const values: Array<number | undefined> = [];
    await engine.use(provider(0, log, "t0"));
    await engine.use(
      consumer("Soft", { optional: ["p783:svc"] }, () => {
        watchService("p783:svc", (value) => {
          values.push(value?.n);
        });
      }),
    );
    const cold = engine.getStats().hookListeners;

    let count = 0;
    for (let i = 1; i <= 50; i++) {
      const report = await hotReplacePlugin(engine, "Local", provider(i, log, `t${i}`));
      if (report.status === "applied") count += report.count;
    }

    expect(count).toBe(50);
    expect(engine.getStats().hookListeners).toBe(cold);
    expect(values.at(-1)).toBe(50);
  });

  it("a stopped engine returns reload engine-not-running", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.stop();

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual({
      status: "reload",
      kind: "plugin",
      name: "Local",
      reason: "engine-not-running",
    });
  });

  it("a swap requested inside onUpdate applies only after the frame", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(provider(1, log, "old"));
    let swap: Promise<GwenHotReport> | undefined;
    const Probe = defineSystem("probe", () => {
      onUpdate(() => {
        swap ??= hotReplacePlugin(engine, "Local", provider(2, log, "new"));
        log.push("frame body");
      });
    });
    await engine.use(Probe());
    log.length = 0;

    await engine.advance(0.016);
    const duringFrame = [...log];
    const report = await swap;

    expect(duringFrame).toEqual(["frame body"]);
    expect(report).toEqual(applied("Local", 1));
    expect(log).toEqual(["frame body", "old teardown start", "old teardown end", "new setup"]);
  });

  it("a plugin nothing installed is installed by the swap and counts 1", async () => {
    const engine = await boot();
    const log: string[] = [];

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual(applied("Local", 1));
    expect(log).toEqual(["new setup"]);
    expect(engine.getStats().plugins).toEqual(["Local"]);
  });

  it("a service change outside a swap keeps its reason", async () => {
    const engine = await boot();
    const log: string[] = [];
    const events: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.use(
      consumer("Soft", { optional: ["p783:svc"] }, (host) => {
        host.hooks.hook("service:removed", (e) => {
          events.push(`removed:${e.reason}`);
        });
        host.hooks.hook("service:provided", (e) => {
          events.push(`provided:${e.reason}`);
        });
      }),
    );

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual(applied("Local", 1));
    expect(events).toEqual(["removed:hot-replace", "provided:hot-replace"]);
    events.length = 0;
    await engine.unuse("Local");
    expect(events).toEqual(["removed:unuse"]);
  });

  it("the swap mark is cleared when the new setup throws", async () => {
    const engine = await boot();
    const log: string[] = [];
    const events: string[] = [];
    await engine.use(provider(1, log, "old"));
    await engine.use(
      consumer("Soft", { optional: ["p783:svc"] }, (host) => {
        host.hooks.hook("service:removed", (e) => {
          events.push(`removed:${e.reason}`);
        });
        host.hooks.hook("service:provided", (e) => {
          events.push(`provided:${e.reason}`);
        });
      }),
    );

    const report = await hotReplacePlugin(engine, "Local", throwingSetup());

    expect(report).toEqual(applied("Local", 0));
    events.length = 0;
    await engine.use(provider(4, log, "again"));
    await engine.unuse("Local");
    expect(events).toEqual(["provided:install", "removed:unuse"]);
  });

  it("a throwing setup of the new plugin is reported and the engine keeps running", async () => {
    const engine = await boot();
    const log: string[] = [];
    const notes: BusNote[] = [];
    await engine.use(provider(1, log, "old"));
    watchErrors(engine, notes);

    const report = await hotReplacePlugin(engine, "Local", throwingSetup());

    expect(report).toEqual(applied("Local", 0));
    expect(notes).toEqual([{ code: "CORE:PLUGIN_SETUP_ERROR", phase: "setup" }]);
    expect(engine.getStats().plugins).toEqual([]);
    await engine.advance(0.016);
    const again = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));
    expect(again).toEqual(applied("Local", 1));
    expect(engine.getStats().plugins).toEqual(["Local"]);
    expect(engine.inject("p783:svc")).toEqual({ n: 2 });
  });

  it("a missing dependency of the new plugin is reported on the error bus", async () => {
    const engine = await boot();
    const log: string[] = [];
    const notes: BusNote[] = [];
    await engine.use(provider(1, log, "old"));
    watchErrors(engine, notes);

    const report = await hotReplacePlugin(engine, "Local", missingDependency());

    expect(report).toEqual(applied("Local", 0));
    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", phase: "setup" }]);
    expect(engine.getStats().plugins).toEqual([]);
  });

  it("a throwing teardown of the old plugin is reported and the new plugin still installs", async () => {
    const engine = await boot();
    const log: string[] = [];
    const notes: BusNote[] = [];
    await engine.use(
      provider(1, log, "old", async () => {
        throw new Error("teardown failed");
      }),
    );
    watchErrors(engine, notes);

    const report = await hotReplacePlugin(engine, "Local", provider(2, log, "new"));

    expect(report).toEqual(applied("Local", 1));
    expect(engine.inject("p783:svc")).toEqual({ n: 2 });
    expect(engine.getStats().plugins).toEqual(["Local"]);
    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", phase: "teardown" }]);
  });

  it("a stop() during the old teardown reports reload engine-not-running and emits no error", async () => {
    const engine = await boot();
    const log: string[] = [];
    const notes: BusNote[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await engine.use(provider(1, log, "old", () => gate));
    watchErrors(engine, notes);
    const swap = hotReplacePlugin(engine, "Local", provider(2, log, "new"));
    let stopping: Promise<void> | undefined;
    try {
      for (let i = 0; i < 20 && !log.includes("old teardown start"); i += 1) {
        await Promise.resolve();
      }
      stopping = engine.stop();
      for (let i = 0; i < 20 && engine.state !== "stopping"; i += 1) await Promise.resolve();
      release();
      const report = await swap;
      expect(report).toEqual({
        status: "reload",
        kind: "plugin",
        name: "Local",
        reason: "engine-not-running",
      });
      expect(notes.filter((note) => note.code === "CORE:PLUGIN_RUNTIME_ERROR")).toEqual([]);
    } finally {
      release();
      await swap.catch(() => undefined);
      await stopping?.catch(() => undefined);
    }
  });

  it("a rename to Local2 reports the old name, a soft consumer sees hot-replace, and another engine keeps unuse", async () => {
    const blocked = await boot();
    const blockedLog: string[] = [];
    await blocked.use(provider(1, blockedLog, "old"));
    await blocked.use(consumer("Layered", { plugins: ["Local"] }));

    const blockedReport = await hotReplacePlugin(
      blocked,
      "Local",
      provider(2, blockedLog, "next", undefined, "Local2"),
    );

    expect(blockedReport).toEqual({
      status: "reload",
      kind: "plugin",
      name: "Local",
      reason: "plugin-in-use",
      detail: "Layered",
    });
    expect(blocked.getStats().plugins).toEqual(["Local", "Layered"]);

    const left = await boot();
    const right = await boot();
    const log: string[] = [];
    const leftEvents: string[] = [];
    const rightEvents: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await left.use(provider(1, log, "old", () => gate));
    await left.use(
      consumer("Soft", { optional: ["p783:svc"] }, (host) => {
        host.hooks.hook("service:removed", (e) => {
          leftEvents.push(`removed:${e.reason}`);
        });
        host.hooks.hook("service:provided", (e) => {
          leftEvents.push(`provided:${e.reason}`);
        });
      }),
    );
    await right.use(provider(1, log, "right"));
    await right.use(
      consumer("SoftRight", { optional: ["p783:svc"] }, (host) => {
        host.hooks.hook("service:removed", (e) => {
          rightEvents.push(`removed:${e.reason}`);
        });
      }),
    );
    const swap = hotReplacePlugin(left, "Local", provider(2, log, "new", undefined, "Local2"));
    try {
      for (let i = 0; i < 20 && !log.includes("old teardown start"); i += 1) {
        await Promise.resolve();
      }
      await right.unuse("Local");
      release();
      const report = await swap;

      expect(report).toEqual(applied("Local", 1));
      expect(left.getStats().plugins).toEqual(["Soft", "Local2"]);
      expect(leftEvents).toEqual(["removed:hot-replace", "provided:hot-replace"]);
      expect(rightEvents).toEqual(["removed:unuse"]);
    } finally {
      release();
      await swap.catch(() => undefined);
    }
  });

  it("a swap onto an already installed name counts 0 and leaves that plugin untouched", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(plain("Local", log));
    await engine.use(plain("Other", log));
    log.length = 0;

    const report = await hotReplacePlugin(engine, "Local", plain("Other", log));

    expect(report).toEqual(applied("Local", 0));
    expect(log).toEqual(["Local teardown"]);
    expect(engine.getStats().plugins).toEqual(["Other"]);
  });

  it("a throwing setup when nothing was installed reports applied count 0", async () => {
    const engine = await boot();
    const notes: BusNote[] = [];
    watchErrors(engine, notes);

    const report = await hotReplacePlugin(engine, "Local", throwingSetup());

    expect(report).toEqual(applied("Local", 0));
    expect(notes).toEqual([{ code: "CORE:PLUGIN_SETUP_ERROR", phase: "setup" }]);
    expect(engine.getStats().plugins).toEqual([]);
  });
});
