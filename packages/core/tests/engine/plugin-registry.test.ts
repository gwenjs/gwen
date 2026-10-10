/**
 * PluginRegistry without an engine.
 * Setup, teardown, and hooks run on the objects this file builds.
 */

import { createHooks, type Hookable } from "hookable";
import { afterEach, describe, expect, it } from "vitest";
import type { IGwenLogger } from "@gwenjs/schema";
import type { GwenPlugin } from "../../src/engine/engine-types";
import type { EngineErrorBus, GwenEngine } from "../../src/engine/engine-types";
import type { GwenRuntimeHooks } from "../../src/engine/runtime-hooks";
import { createEngine } from "../../src/index";
import { GwenEngineStateError } from "../../src/engine/engine-errors";
import { engineContext } from "../../src/engine/context";
import { ScopedHooksTracker } from "../../src/engine/hook-tracker";
import { PluginRegistry, type PluginRegistryDeps } from "../../src/engine/plugin-registry";

afterEach(() => {
  engineContext.unset();
});

function quietLogger(lines: string[]): IGwenLogger {
  const logger: IGwenLogger = {
    debug(message) {
      lines.push(message);
    },
    info() {},
    warn() {},
    error() {},
    child() {
      return logger;
    },
  };
  return logger;
}

function recordingBus(events: { code: string; message: string; frame: unknown }[]): EngineErrorBus {
  return {
    emit(event) {
      events.push({
        code: event.code,
        message: event.message,
        frame: event.context?.["frame"],
      });
    },
    on() {
      return () => {};
    },
    onFatal() {
      return () => {};
    },
  };
}

function rig(over: Partial<PluginRegistryDeps> = {}) {
  const bus = createHooks<GwenRuntimeHooks>();
  const receiver: Pick<GwenEngine, "hooks"> = { hooks: bus };
  const remembered: GwenEngine[] = [];
  const setupReports: { name: string; message: string }[] = [];
  const teardownReports: { name: string; message: string }[] = [];
  const emitted: { code: string; message: string; frame: unknown }[] = [];
  const debugLines: string[] = [];
  const dropped: string[] = [];
  const deps: PluginRegistryDeps = {
    hooks: bus,
    tracker: new ScopedHooksTracker(),
    errors: recordingBus(emitted),
    assertState() {},
    logger: quietLogger(debugLines),
    debug: false,
    remember(proxy) {
      remembered.push(proxy);
    },
    frame: () => 7,
    reportSetup(plugin, error) {
      setupReports.push({
        name: plugin.name,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    reportTeardown(plugin, error) {
      teardownReports.push({
        name: plugin.name,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    dropIsolation(name) {
      dropped.push(name);
    },
    ...over,
  };
  return {
    bus,
    receiver,
    remembered,
    setupReports,
    teardownReports,
    emitted,
    debugLines,
    dropped,
    registry: new PluginRegistry(deps),
  };
}

describe("PluginRegistry", () => {
  it("constructs without createEngine and use tracks the plugin hook until unuse", async () => {
    const { bus, receiver, remembered, debugLines, dropped, registry } = rig({ debug: true });
    let hits = 0;
    let seenScoped = false;
    const plugin: GwenPlugin = {
      name: "alpha",
      setup(engine) {
        seenScoped = engine.hooks !== bus;
        engine.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
    };
    let registered = "";
    bus.hook("plugin:registered", (name) => {
      registered = name;
    });

    await registry.use(plugin, receiver);
    await bus.callHook("engine:update", 0);
    await registry.unuse("alpha", receiver);
    await bus.callHook("engine:update", 0);

    expect(seenScoped).toBe(true);
    expect(remembered[0]?.hooks).not.toBe(bus);
    expect(registered).toBe("alpha");
    expect(debugLines).toEqual(["plugin registered: alpha"]);
    expect(dropped).toEqual(["alpha"]);
    expect(hits).toBe(1);
  });

  it("constructs without createEngine and a second use of the same name does not run setup", async () => {
    const { receiver, registry } = rig();
    let setups = 0;
    const plugin: GwenPlugin = {
      name: "alpha",
      setup() {
        setups += 1;
      },
    };

    await registry.use(plugin, receiver);
    await registry.use(plugin, receiver);

    expect(setups).toBe(1);
  });

  it("constructs without createEngine and use while stopped throws invalid state and does not call setup", async () => {
    const { receiver, registry } = rig({
      assertState(method) {
        throw new GwenEngineStateError("stopped", method);
      },
    });
    let setups = 0;
    const plugin: GwenPlugin = {
      name: "alpha",
      setup() {
        setups += 1;
      },
    };

    await expect(registry.use(plugin, receiver)).rejects.toThrow();
    expect(setups).toBe(0);
  });

  it("constructs without createEngine and a rejected setup drops the hook and reports the message", async () => {
    const { bus, receiver, setupReports, registry } = rig();
    let hits = 0;
    const plugin: GwenPlugin = {
      name: "alpha",
      setup(engine) {
        engine.hooks.hook("engine:update", () => {
          hits += 1;
        });
        throw new Error("setup-boom");
      },
    };

    await expect(registry.use(plugin, receiver)).rejects.toThrow("setup-boom");
    await bus.callHook("engine:update", 0);

    expect(setupReports).toEqual([{ name: "alpha", message: "setup-boom" }]);
    expect(hits).toBe(0);
  });

  it("constructs without createEngine and unuse runs teardown with the receiver current then drops the hook", async () => {
    const { bus, receiver, registry } = rig();
    let hits = 0;
    let current: unknown;
    const plugin: GwenPlugin = {
      name: "alpha",
      setup(engine) {
        engine.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
      teardown() {
        current = engineContext.tryUse();
      },
    };

    await registry.use(plugin, receiver);
    await bus.callHook("engine:update", 0);
    await registry.unuse("alpha", receiver);
    await bus.callHook("engine:update", 0);

    expect(current).toBe(receiver);
    expect(hits).toBe(1);
  });

  it("constructs without createEngine and a throwing teardown still drops the hook and reports", async () => {
    const { bus, receiver, teardownReports, registry } = rig();
    let hits = 0;
    const plugin: GwenPlugin = {
      name: "alpha",
      setup(engine) {
        engine.hooks.hook("engine:update", () => {
          hits += 1;
        });
      },
      teardown() {
        throw new Error("teardown-boom");
      },
    };

    await registry.use(plugin, receiver);
    await bus.callHook("engine:update", 0);
    await expect(registry.unuse("alpha", receiver)).resolves.toBeUndefined();
    await bus.callHook("engine:update", 0);

    expect(teardownReports).toEqual([{ name: "alpha", message: "teardown-boom" }]);
    expect(hits).toBe(1);
  });

  it("constructs without createEngine and clearHooks drops every plugin hook", async () => {
    const { bus, receiver, registry } = rig();
    let hits = 0;
    const hook = () => {
      hits += 1;
    };
    await registry.use(
      {
        name: "alpha",
        setup(engine) {
          engine.hooks.hook("engine:update", hook);
        },
      },
      receiver,
    );
    await registry.use(
      {
        name: "beta",
        setup(engine) {
          engine.hooks.hook("engine:update", hook);
        },
      },
      receiver,
    );

    await bus.callHook("engine:update", 0);
    registry.clearHooks();
    await bus.callHook("engine:update", 0);

    expect(hits).toBe(2);
  });

  it("constructs without createEngine and unuse of an unknown name keeps the hook", async () => {
    const { bus, receiver, registry } = rig();
    let hits = 0;
    await registry.use(
      {
        name: "alpha",
        setup(engine) {
          engine.hooks.hook("engine:update", () => {
            hits += 1;
          });
        },
      },
      receiver,
    );

    await registry.unuse("missing", receiver);
    await bus.callHook("engine:update", 0);

    expect(hits).toBe(1);
  });

  it("constructs without createEngine and engine:memory-grow throw is reported and does not reject the hook", async () => {
    const { bus, receiver, emitted, registry } = rig();
    await registry.use(
      {
        name: "alpha",
        setup(engine) {
          engine.hooks.hook("engine:memory-grow", () => {
            throw new Error("grow-boom");
          });
        },
      },
      receiver,
    );

    await expect(
      bus.callHook("engine:memory-grow", { epoch: 1, byteLength: 2, frame: 3 }),
    ).resolves.toBeUndefined();

    expect(emitted).toEqual([
      {
        code: "CORE:PLUGIN_RUNTIME_ERROR",
        message: "[alpha] engine:memory-grow threw: grow-boom",
        frame: 7,
      },
    ]);
  });

  it("constructs without createEngine and clearHooks leaves the other registry's hook", async () => {
    const left = rig();
    const right = rig();
    let leftHits = 0;
    let rightHits = 0;
    await left.registry.use(
      {
        name: "alpha",
        setup(engine) {
          engine.hooks.hook("engine:update", () => {
            leftHits += 1;
          });
        },
      },
      left.receiver,
    );
    await right.registry.use(
      {
        name: "alpha",
        setup(engine) {
          engine.hooks.hook("engine:update", () => {
            rightHits += 1;
          });
        },
      },
      right.receiver,
    );

    left.registry.clearHooks();
    await left.bus.callHook("engine:update", 0);
    await right.bus.callHook("engine:update", 0);

    expect(leftHits).toBe(0);
    expect(rightHits).toBe(1);
  });

  it("a hook registered inside use observes the same microtask order as before", async () => {
    const engine = await createEngine();
    try {
      const order: string[] = [];
      const pending = engine.use({
        name: "alpha",
        setup(api) {
          api.hooks.hook("plugin:registered", () => {
            let n = 0;
            const step = (): void => {
              order.push(String(n));
              n += 1;
              if (n <= 4) queueMicrotask(step);
            };
            queueMicrotask(step);
          });
        },
      });
      pending.then(
        () => {
          order.push("settled");
        },
        () => {
          order.push("rejected");
        },
      );
      await pending;
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      expect(order).toEqual(["0", "1", "settled", "2", "3", "4"]);
    } finally {
      await engine.stop();
    }
  });
});
