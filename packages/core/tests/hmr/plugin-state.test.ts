import { afterEach, describe, expect, it } from "vitest";
import type { GwenEngineBase, GwenPluginHot } from "@gwenjs/schema";
import { defineActor, onDestroy } from "../../src/actor/runtime/define-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import type { GwenEngine, GwenPlugin } from "../../src/engine/engine-types.js";
import { onCleanup } from "../../src/hooks/index.js";
import { SceneEnginePlugin } from "../../src/scene/engine-plugin";
import { defineScene } from "../../src/scene/runtime/define-scene";
import { hotReplacePlugin, type GwenHotReport } from "../../src/internal.js";
import { createEngine } from "../../src/node.js";
import { createSystemHandle } from "../../src/scene/runtime/system-handle";
import { defineSystem, onUpdate, useService } from "../../src/system/runtime/define-system";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p783c:svc": { readonly n: number };
    "p783c:other": { readonly n: number };
  }
}

const engines: GwenEngine[] = [];

async function boot(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

interface Provider {
  readonly n: number;
  readonly log?: string[];
  readonly tag?: string;
  readonly hot?: GwenPluginHot;
  readonly name?: string;
  readonly setupThrows?: boolean;
}

/** A plugin that provides `p783c:svc` with `n`. Setup and teardown append to `log`. */
function provider(options: Provider): GwenPlugin {
  const tag = options.tag ?? "p";
  const plugin: GwenPlugin = {
    name: options.name ?? "Local",
    provides: ["p783c:svc"],
    setup(host: GwenEngineBase) {
      options.log?.push(`${tag} setup`);
      if (options.setupThrows === true) throw new Error("setup failed");
      host.provide("p783c:svc", { n: options.n });
    },
    teardown() {
      options.log?.push(`${tag} teardown`);
    },
  };
  return options.hot === undefined ? plugin : { ...plugin, hot: options.hot };
}

/** A plugin that provides `p783c:other` and is never swapped. */
function bystander(log: string[]): GwenPlugin {
  return {
    name: "Bystander",
    provides: ["p783c:other"],
    setup(host: GwenEngineBase) {
      log.push("bystander setup");
      host.provide("p783c:other", { n: 100 });
    },
  };
}

const applied = (count: number): GwenHotReport => ({
  status: "applied",
  kind: "plugin",
  name: "Local",
  count,
});

interface BusNote {
  readonly code: string;
  readonly kind: string | undefined;
  readonly name: string | undefined;
}

function watch(engine: GwenEngine): BusNote[] {
  const notes: BusNote[] = [];
  engine.errors.on((event) => {
    notes.push({ code: event.code, kind: event.target?.kind, name: event.target?.name });
  });
  return notes;
}

describe.runIf(__GWEN_DEV__)("hot state of a swapped plugin", () => {
  it("hot.save runs before teardown and hot.restore receives its value after setup", async () => {
    const engine = await boot();
    const log: string[] = [];
    await engine.use(
      provider({
        n: 1,
        log,
        tag: "old",
        hot: {
          save() {
            log.push("save");
            return { count: 7 };
          },
          restore() {
            log.push("old restore");
          },
        },
      }),
    );
    log.length = 0;

    const report = await hotReplacePlugin(
      engine,
      "Local",
      provider({
        n: 2,
        log,
        tag: "new",
        hot: {
          save() {
            return undefined;
          },
          restore(state) {
            log.push(`restore ${JSON.stringify(state)}`);
          },
        },
      }),
    );

    expect(report).toEqual(applied(1));
    expect(log).toEqual(["save", "old teardown", "new setup", 'restore {"count":7}']);
  });

  it("a plugin without hot starts with fresh state and its successor receives what it saves", async () => {
    const engine = await boot();
    const restoredByFirst: unknown[] = [];
    const restoredBySecond: unknown[] = [];
    await engine.use(provider({ n: 1 }));

    await hotReplacePlugin(
      engine,
      "Local",
      provider({
        n: 2,
        hot: {
          save: () => 5,
          restore: (state) => restoredByFirst.push(state),
        },
      }),
    );
    await hotReplacePlugin(
      engine,
      "Local",
      provider({ n: 3, hot: { save: () => 6, restore: (state) => restoredBySecond.push(state) } }),
    );

    expect(restoredByFirst).toEqual([]);
    expect(restoredBySecond).toEqual([5]);
  });

  it("a new plugin without hot drops the saved state and nothing throws", async () => {
    const engine = await boot();
    const log: string[] = [];
    const notes = watch(engine);
    await engine.use(
      provider({
        n: 1,
        hot: {
          save() {
            log.push("save");
            return 1;
          },
          restore() {},
        },
      }),
    );

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));

    expect(report).toEqual(applied(1));
    expect(log).toEqual(["save"]);
    expect(notes).toEqual([]);
  });

  it("a throwing hot.restore emits CORE:PLUGIN_RUNTIME_ERROR with target and the plugin runs", async () => {
    const engine = await boot();
    const notes = watch(engine);
    const phases: unknown[] = [];
    engine.errors.on((event) => {
      phases.push(event.context?.["phase"]);
    });
    await engine.use(provider({ n: 1, hot: { save: () => 1, restore() {} } }));

    const report = await hotReplacePlugin(
      engine,
      "Local",
      provider({
        n: 2,
        hot: {
          save: () => 2,
          restore() {
            throw new Error("restore failed");
          },
        },
      }),
    );

    expect(report).toEqual({ ...applied(1), detail: "hot state not restored" });
    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "plugin", name: "Local" }]);
    expect(phases).toEqual(["setup"]);
    expect(engine.getStats().plugins).toEqual(["Local"]);
    expect(engine.inject("p783c:svc")).toEqual({ n: 2 });
  });

  it("a throwing hot.save emits CORE:PLUGIN_RUNTIME_ERROR, the swap still happens and restore is not called", async () => {
    const engine = await boot();
    const notes = watch(engine);
    const phases: unknown[] = [];
    engine.errors.on((event) => {
      phases.push(event.context?.["phase"]);
    });
    const restored: unknown[] = [];
    await engine.use(
      provider({
        n: 1,
        hot: {
          save() {
            throw new Error("save failed");
          },
          restore() {},
        },
      }),
    );

    const report = await hotReplacePlugin(
      engine,
      "Local",
      provider({ n: 2, hot: { save: () => 0, restore: (state) => restored.push(state) } }),
    );

    expect(report).toEqual({ ...applied(1), detail: "hot state not restored" });
    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "plugin", name: "Local" }]);
    expect(phases).toEqual(["teardown"]);
    expect(restored).toEqual([]);
    expect(engine.inject("p783c:svc")).toEqual({ n: 2 });
  });

  it("restore is not called when the new setup throws and the state saved before the teardown is dropped", async () => {
    const engine = await boot();
    const restored: unknown[] = [];
    const saved: string[] = [];
    await engine.use(
      provider({
        n: 1,
        hot: {
          save() {
            saved.push("save");
            return 9;
          },
          restore() {},
        },
      }),
    );

    const report = await hotReplacePlugin(
      engine,
      "Local",
      provider({
        n: 2,
        setupThrows: true,
        hot: { save: () => 0, restore: (state) => restored.push(state) },
      }),
    );
    const afterFailure = [...saved];
    // The failed swap left nothing installed: the next swap has no state to restore.
    const next: unknown[] = [];
    await hotReplacePlugin(
      engine,
      "Local",
      provider({ n: 3, hot: { save: () => 0, restore: (state) => next.push(state) } }),
    );

    expect(report).toEqual(applied(0));
    expect(afterFailure).toEqual(["save"]);
    expect(restored).toEqual([]);
    expect(next).toEqual([]);
    expect(engine.getStats().plugins).toEqual(["Local"]);
  });

  it("a swap blocked by a dependent saves nothing and a later swap saves once and restores", async () => {
    const engine = await boot();
    const saved: string[] = [];
    const restored: unknown[] = [];
    await engine.use(
      provider({
        n: 1,
        hot: {
          save() {
            saved.push("save");
            return 4;
          },
          restore() {},
        },
      }),
    );
    await engine.use({ name: "Hard", requires: { services: ["p783c:svc"] }, setup() {} });

    const blocked = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    const savedWhileBlocked = [...saved];
    await engine.unuse("Hard");
    const second = await hotReplacePlugin(
      engine,
      "Local",
      provider({ n: 3, hot: { save: () => 0, restore: (state) => restored.push(state) } }),
    );

    expect(blocked).toEqual({
      status: "reload",
      kind: "plugin",
      name: "Local",
      reason: "plugin-in-use",
      detail: "Hard",
    });
    expect(savedWhileBlocked).toEqual([]);
    expect(second).toEqual(applied(1));
    expect(saved).toEqual(["save"]);
    expect(restored).toEqual([4]);
  });

  it("two engines with the same local plugin are both swapped with their own state", async () => {
    const first = await boot();
    const second = await boot();
    const restored: Record<string, unknown[]> = { first: [], second: [] };
    const hot = (own: number, into: unknown[]): GwenPluginHot => ({
      save: () => own,
      restore: (state) => into.push(state),
    });
    await first.use(provider({ n: 1, hot: hot(11, []) }));
    await second.use(provider({ n: 1, hot: hot(22, []) }));

    const a = await hotReplacePlugin(
      first,
      "Local",
      provider({ n: 2, hot: hot(0, restored["first"] ?? []) }),
    );
    const b = await hotReplacePlugin(
      second,
      "Local",
      provider({ n: 3, hot: hot(0, restored["second"] ?? []) }),
    );

    expect(a).toEqual(applied(1));
    expect(b).toEqual(applied(1));
    expect(restored).toEqual({ first: [11], second: [22] });
    expect(first.inject("p783c:svc")).toEqual({ n: 2 });
    expect(second.inject("p783c:svc")).toEqual({ n: 3 });
  });

  it("a plugin that declares hot installs without an unknown-key warning", async () => {
    const warns: string[] = [];
    const engine = await createEngine({
      debug: true,
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
    engines.push(engine);
    const before = warns.length;

    await engine.use(provider({ n: 1, hot: { save: () => 1, restore() {} } }));

    expect(warns.slice(before)).toEqual([]);
  });
});

describe.runIf(__GWEN_DEV__)("readers of a swapped plugin's service", () => {
  it("a system that read the swapped plugin's service runs again and sees the new service", async () => {
    const engine = await boot();
    const seen: number[] = [];
    const Reader = defineSystem("Reader", () => {
      const svc = useService("p783c:svc");
      onUpdate(() => {
        seen.push(svc.n);
      });
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Reader());
    await engine.advance(0.016);

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    await engine.advance(0.016);

    expect(report).toEqual(applied(1));
    expect(seen).toEqual([1, 2]);
  });

  it("an actor that read the swapped plugin's service is respawned in place and sees the new service", async () => {
    const engine = await boot();
    const destroyed: number[] = [];
    const Unit = defineActor("Unit", definePrefab([]), () => {
      const svc = useService("p783c:svc");
      onDestroy(() => {
        destroyed.push(svc.n);
      });
      return { n: svc.n };
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn();

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));

    expect(report).toEqual(applied(1));
    expect([...Unit._instances.keys()]).toEqual([id]);
    expect(Unit._instances.get(id)?.api).toEqual({ n: 2 });
    expect(destroyed).toEqual([1]);
  });

  it("an actor reader is destroyed before the old plugin tears down and built again after the new plugin", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Unit = defineActor("Unit", definePrefab([]), () => {
      const svc = useService("p783c:svc");
      log.push(`actor built ${svc.n}`);
      onDestroy(() => {
        log.push(`actor destroyed ${svc.n}`);
      });
      return {};
    });
    await engine.use(provider({ n: 1, log, tag: "old" }));
    await engine.use(Unit._plugin);
    Unit._plugin.spawn();
    log.length = 0;

    await hotReplacePlugin(engine, "Local", provider({ n: 2, log, tag: "new" }));

    expect(log).toEqual(["actor destroyed 1", "old teardown", "new setup", "actor built 2"]);
  });

  it("an actor reader whose factory throws when built again emits CORE:PLUGIN_RUNTIME_ERROR with its target and is isolated", async () => {
    const engine = await boot();
    const notes = watch(engine);
    let builds = 0;
    const Unit = defineActor("Unit", definePrefab([]), () => {
      useService("p783c:svc");
      builds++;
      if (builds > 1) throw new Error("actor failed");
      return {};
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Unit._plugin);
    const id = Unit._plugin.spawn();

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));

    expect(report).toEqual(applied(1));
    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "actor", name: "Unit" }]);
    expect(engine.isolated().map((target) => target.name)).toEqual(["Unit"]);
    expect([...Unit._instances.keys()]).toEqual([id]);
  });

  it("readers are set up again in their place and other plugins and systems are not", async () => {
    const engine = await boot();
    const order: string[] = [];
    const setups: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, bystander: 0 };
    const bump = (key: string): void => {
      setups[key] = (setups[key] ?? 0) + 1;
    };
    const A = defineSystem("A", () => {
      bump("A");
      const svc = useService("p783c:svc");
      onUpdate(() => {
        order.push(`A:${svc.n}`);
      });
    });
    const B = defineSystem("B", () => {
      bump("B");
      onUpdate(() => {
        order.push("B");
      });
    });
    const C = defineSystem("C", () => {
      bump("C");
      const svc = useService("p783c:svc");
      onUpdate(() => {
        order.push(`C:${svc.n}`);
      });
    });
    const D = defineSystem("D", () => {
      bump("D");
      const other = useService("p783c:other");
      onUpdate(() => {
        order.push(`D:${other.n}`);
      });
    });
    const log: string[] = [];
    await engine.use(provider({ n: 1 }));
    await engine.use(bystander(log));
    await engine.use(A());
    await engine.use(B());
    await engine.use(C());
    await engine.use(D());
    setups["bystander"] = log.length;

    await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    order.length = 0;
    await engine.advance(0.016);

    expect(order).toEqual(["A:2", "B", "C:2", "D:100"]);
    expect(setups).toEqual({ A: 2, B: 1, C: 2, D: 1, bystander: 1 });
    expect(log).toEqual(["bystander setup"]);
  });

  it("a paused reader stays paused through the swap and sees the new service after resume", async () => {
    const engine = await boot();
    const seen: number[] = [];
    const Reader = defineSystem("Reader", () => {
      const svc = useService("p783c:svc");
      onUpdate(() => {
        seen.push(svc.n);
      });
    });
    const { plugin, handle } = createSystemHandle(Reader());
    await engine.use(provider({ n: 1 }));
    await engine.use(plugin);
    handle.pause();

    await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    await engine.advance(0.016);
    const whilePaused = [...seen];
    handle.resume();
    await engine.advance(0.016);

    expect(whilePaused).toEqual([]);
    expect(seen).toEqual([2]);
  });

  it("the old reader is disposed before the old plugin tears down and the new one is set up after the new plugin", async () => {
    const engine = await boot();
    const log: string[] = [];
    const Reader = defineSystem("Reader", () => {
      const svc = useService("p783c:svc");
      log.push(`reader setup ${svc.n}`);
      onCleanup(() => {
        log.push(`reader cleanup ${svc.n}`);
      });
    });
    await engine.use(provider({ n: 1, log, tag: "old" }));
    await engine.use(Reader());
    log.length = 0;

    await hotReplacePlugin(engine, "Local", provider({ n: 2, log, tag: "new" }));

    expect(log).toEqual(["reader cleanup 1", "old teardown", "new setup", "reader setup 2"]);
  });

  it("a reader set up again sees the state hot.restore wrote", async () => {
    const engine = await boot();
    const shared = { value: 0 };
    const built: number[] = [];
    const Reader = defineSystem("Reader", () => {
      useService("p783c:svc");
      built.push(shared.value);
    });
    const hot = {
      save: () => 7,
      restore: (state: unknown) => {
        shared.value = Number(state);
      },
    };
    await engine.use(provider({ n: 1, hot }));
    await engine.use(Reader());

    await hotReplacePlugin(engine, "Local", provider({ n: 2, hot }));

    expect(built).toEqual([0, 7]);
  });

  it("only the readers of the swapped engine are set up again", async () => {
    const first = await boot();
    const second = await boot();
    const seen: string[] = [];
    const Reader = defineSystem("Reader", () => {
      const svc = useService("p783c:svc");
      onUpdate(() => {
        seen.push(`n${svc.n}`);
      });
    });
    await first.use(provider({ n: 1 }));
    await second.use(provider({ n: 1 }));
    await first.use(Reader());
    await second.use(Reader());

    await hotReplacePlugin(first, "Local", provider({ n: 2 }));
    await first.advance(0.016);
    await second.advance(0.016);

    expect(seen).toEqual(["n2", "n1"]);
  });

  it("a reader removed from the engine before the swap is not set up again", async () => {
    const engine = await boot();
    let gone = 0;
    let kept = 0;
    const Gone = defineSystem("Gone", () => {
      gone++;
      useService("p783c:svc");
    });
    const Kept = defineSystem("Kept", () => {
      kept++;
      useService("p783c:svc");
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Gone());
    await engine.use(Kept());
    await engine.unuse("Gone");

    await hotReplacePlugin(engine, "Local", provider({ n: 2 }));

    expect({ gone, kept }).toEqual({ gone: 1, kept: 2 });
  });

  it("a reader that throws when set up again emits CORE:PLUGIN_RUNTIME_ERROR with its target and the swap applies", async () => {
    const engine = await boot();
    const notes = watch(engine);
    let runs = 0;
    const Reader = defineSystem("Reader", () => {
      useService("p783c:svc");
      runs++;
      if (runs > 1) throw new Error("reader failed");
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Reader());

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));

    expect(report).toEqual(applied(1));
    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "system", name: "Reader" }]);
    expect(engine.isolated().map((target) => target.name)).toEqual(["Reader"]);
  });

  it("a reader of a service whose new provider failed to install is isolated with CORE:PLUGIN_RUNTIME_ERROR", async () => {
    const engine = await boot();
    const notes = watch(engine);
    const Reader = defineSystem("Reader", () => {
      useService("p783c:svc");
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Reader());

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2, setupThrows: true }));

    expect(report).toEqual(applied(0));
    expect(notes.map((note) => note.code)).toEqual([
      "CORE:PLUGIN_SETUP_ERROR",
      "CORE:PLUGIN_RUNTIME_ERROR",
    ]);
    expect(engine.isolated().map((target) => target.name)).toContain("Reader");
  });

  it("a scene that read the swapped plugin's service reports reload plugin-in-use and nothing is retired", async () => {
    const engine = await boot();
    const log: string[] = [];
    const saved: string[] = [];
    await engine.use(SceneEnginePlugin());
    await engine.use(
      provider({
        n: 1,
        log,
        tag: "old",
        hot: {
          save() {
            saved.push("save");
            return 1;
          },
          restore() {},
        },
      }),
    );
    const Level = defineScene("Level", () => {
      useService("p783c:svc");
    });
    let setups = 0;
    const seen: number[] = [];
    const Reader = defineSystem("Reader", () => {
      setups++;
      const svc = useService("p783c:svc");
      onUpdate(() => {
        seen.push(svc.n);
      });
    });
    await engine.use(Reader());
    await engine.advance(0.016);
    seen.length = 0;
    engine.run(() => Level({ register: () => {} }));
    log.length = 0;

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 2, log, tag: "new" }));

    expect(report.status).toBe("reload");
    expect(report).toMatchObject({
      kind: "plugin",
      name: "Local",
      reason: "plugin-in-use",
      detail: expect.stringMatching(/^scene .+ reads p783c:svc$/),
    });
    expect(log).toEqual([]);
    expect(saved).toEqual([]);
    expect(engine.inject("p783c:svc")).toEqual({ n: 1 });
    expect(setups).toBe(1);
    await engine.advance(0.016);
    expect(seen).toEqual([1]);
  });

  it("a plugin that read the swapped plugin's service without requiring it reports reload plugin-in-use and the swapped plugin reading its own service does not block", async () => {
    const engine = await boot();
    const reading = (name: string): GwenPlugin => ({
      name,
      setup() {
        useService("p783c:svc");
      },
    });
    const selfReading: GwenPlugin = {
      name: "Local",
      provides: ["p783c:svc"],
      setup(host: GwenEngineBase) {
        host.provide("p783c:svc", { n: 1 });
        useService("p783c:svc");
      },
    };
    await engine.use(selfReading);
    const selfSwap = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    expect(selfSwap).toEqual(applied(1));
    await engine.use(reading("Other"));

    const report = await hotReplacePlugin(engine, "Local", provider({ n: 3 }));

    expect(report).toEqual({
      status: "reload",
      kind: "plugin",
      name: "Local",
      reason: "plugin-in-use",
      detail: "plugin Other reads p783c:svc",
    });
    expect(engine.inject("p783c:svc")).toEqual({ n: 2 });
    await engine.unuse("Other");

    const after = await hotReplacePlugin(engine, "Local", provider({ n: 4 }));

    expect(after).toEqual(applied(1));
    expect(engine.inject("p783c:svc")).toEqual({ n: 4 });
  });

  it("50 swaps leave the hook count and the reader's set-up count in step", async () => {
    const engine = await boot();
    let setups = 0;
    const Reader = defineSystem("Reader", () => {
      setups++;
      useService("p783c:svc");
      onUpdate(() => {});
    });
    await engine.use(provider({ n: 0 }));
    await engine.use(Reader());
    await engine.advance(0.016);
    const baseline = engine.getStats().hookListeners;

    for (let i = 1; i <= 50; i++) {
      await hotReplacePlugin(engine, "Local", provider({ n: i }));
    }

    expect(setups).toBe(51);
    expect(engine.getStats().hookListeners).toBe(baseline);
  });

  it("a reader whose onCleanup throws still applies the swap and a later removal is not hot-replace", async () => {
    const engine = await boot();
    const notes = watch(engine);
    const removed: string[] = [];
    let setups = 0;
    const Keeper = defineSystem("Keeper", () => {
      setups++;
      useService("p783c:svc");
    });
    const Thrower = defineSystem("Thrower", () => {
      useService("p783c:svc");
      onCleanup(() => {
        throw new Error("cleanup failed");
      });
    });
    await engine.use(provider({ n: 1 }));
    await engine.use({
      name: "Watch",
      setup(host: GwenEngineBase) {
        host.hooks.hook("service:removed", (event) => {
          removed.push(event.reason);
        });
      },
    });
    await engine.use(Keeper());
    await engine.use(Thrower());

    let report: GwenHotReport | undefined;
    try {
      report = await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    } catch {
      report = undefined;
    }

    expect(notes).toEqual([{ code: "CORE:PLUGIN_RUNTIME_ERROR", kind: "system", name: "Thrower" }]);
    expect(report).toEqual(applied(1));
    expect(setups).toBe(2);
    expect(engine.inject("p783c:svc")).toEqual({ n: 2 });
    removed.length = 0;

    const second = await hotReplacePlugin(engine, "Local", provider({ n: 3 }));

    expect(second).toEqual(applied(1));
    expect(removed).toEqual(["hot-replace"]);
    removed.length = 0;
    await engine.unuse("Local");
    expect(removed).toEqual(["unuse"]);
  });

  it("a plugin whose teardown drops its own reader does not build that reader again", async () => {
    const engine = await boot();
    const seen: number[] = [];
    const Reader = defineSystem("Reader", () => {
      const svc = useService("p783c:svc");
      onUpdate(() => {
        seen.push(svc.n);
      });
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Reader());
    await engine.advance(0.016);
    await hotReplacePlugin(engine, "Local", provider({ n: 2 }));
    await engine.advance(0.016);
    expect(seen).toEqual([1, 2]);

    const actorEngine = await boot();
    const log: string[] = [];
    const Unit = defineActor("Unit", definePrefab([]), () => {
      const svc = useService("p783c:svc");
      log.push(`actor built ${svc.n}`);
      onUpdate(() => {});
      return {};
    });
    let actorId: ReturnType<(typeof Unit)["_plugin"]["spawn"]> | undefined = undefined;
    const spawning = (n: number, tag: string): GwenPlugin => ({
      name: "Local",
      provides: ["p783c:svc"],
      setup(host: GwenEngineBase) {
        log.push(`${tag} setup`);
        host.provide("p783c:svc", { n });
      },
      teardown() {
        log.push(`${tag} teardown`);
        if (actorId !== undefined) Unit._plugin.despawn(actorId);
      },
    });
    await actorEngine.use(spawning(1, "old"));
    await actorEngine.use(Unit._plugin);
    const baseline = actorEngine.getStats().hookListeners;
    actorId = Unit._plugin.spawn();
    log.length = 0;

    const actorReport = await hotReplacePlugin(actorEngine, "Local", spawning(2, "new"));

    expect(actorReport).toEqual(applied(1));
    expect(log.filter((line) => line.startsWith("actor built"))).toEqual([]);
    expect(actorEngine.getStats().hookListeners).toBe(baseline);

    const dropEngine = await boot();
    let setups = 0;
    const Dropped = defineSystem("Dropped", () => {
      setups++;
      useService("p783c:svc");
      onUpdate(() => {});
    });
    const dropping = (n: number): GwenPlugin => ({
      name: "Local",
      provides: ["p783c:svc"],
      setup(host: GwenEngineBase) {
        host.provide("p783c:svc", { n });
      },
      teardown() {
        return dropEngine.unuse("Dropped");
      },
    });
    await dropEngine.use(provider({ n: 1 }));
    await dropEngine.use(Dropped());
    await hotReplacePlugin(dropEngine, "Local", dropping(2));
    const kept = setups;

    const dropped = await hotReplacePlugin(dropEngine, "Local", provider({ n: 3 }));

    expect(dropped).toEqual(applied(1));
    expect(setups).toBe(kept);
    expect(dropEngine.getStats().plugins).toEqual(["Local"]);
  });

  it("a stop during a swap with a reader reports engine-not-running and a finished swap shows the new service", async () => {
    const engine = await boot();
    const seen: number[] = [];
    let setups = 0;
    const Reader = defineSystem("Reader", () => {
      setups++;
      const svc = useService("p783c:svc");
      onUpdate(() => {
        seen.push(svc.n);
      });
    });
    await engine.use(provider({ n: 1 }));
    await engine.use(Reader());
    await engine.advance(0.016);

    const log: string[] = [];
    let releaseLocal: () => void = () => {};
    let releaseBlocker: () => void = () => {};
    const localGate = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    await engine.use({
      name: "Blocker",
      setup() {},
      teardown() {
        log.push("blocker start");
        return blockerGate;
      },
    });
    const waiting: GwenPlugin = {
      name: "Local",
      provides: ["p783c:svc"],
      setup(host: GwenEngineBase) {
        host.provide("p783c:svc", { n: 2 });
      },
      teardown() {
        log.push("teardown start");
        return localGate;
      },
    };
    const finished = await hotReplacePlugin(engine, "Local", waiting);
    await engine.advance(0.016);
    expect(finished).toEqual(applied(1));
    expect(seen).toEqual([1, 2]);
    expect(setups).toBe(2);

    const notes = watch(engine);
    const swap = hotReplacePlugin(engine, "Local", provider({ n: 3 }));
    let stopping: Promise<void> | undefined;
    try {
      for (let i = 0; i < 20 && !log.includes("teardown start"); i += 1) await Promise.resolve();
      stopping = engine.stop();
      for (let i = 0; i < 20 && !log.includes("blocker start"); i += 1) await Promise.resolve();
      releaseLocal();
      let report: GwenHotReport | undefined;
      try {
        report = await swap;
      } catch {
        report = undefined;
      }
      expect(report).toEqual({
        status: "reload",
        kind: "plugin",
        name: "Local",
        reason: "engine-not-running",
      });
      expect(setups).toBe(2);
      expect(notes).toEqual([]);
    } finally {
      releaseLocal();
      releaseBlocker();
      await swap.catch(() => undefined);
      await stopping?.catch(() => undefined);
    }
  });
});
