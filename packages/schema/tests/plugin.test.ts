/**
 * @gwenjs/schema — GwenPlugin / GwenEngineBase structural tests.
 *
 * These are interface-only types, so tests work with hand-crafted objects
 * and verify structural compatibility and documented behaviour contracts.
 */

import { describe, it, expect, vi } from "vitest";
import type { GwenPlugin, GwenEngineBase, HookBusBase, PluginErrorContext } from "../src/plugin";
import type { GwenDisposable, DisposableRegistryBase } from "../src/disposable";
import type { GwenLogger } from "../src/logger";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeLogger(): GwenLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    setSink: vi.fn(),
  };
}

function makeHookBus(): HookBusBase {
  return {
    hook: vi.fn(),
    removeHook: vi.fn(),
  };
}

function makeDisposable(): GwenDisposable {
  let disposed = false;
  return {
    get disposed() {
      return disposed;
    },
    dispose() {
      disposed = true;
    },
    [Symbol.dispose]() {
      this.dispose();
    },
  };
}

function makeRegistry(): DisposableRegistryBase {
  const items: GwenDisposable[] = [];
  return {
    add(_name, d) {
      items.push(d);
    },
    disposeAll() {
      for (let i = items.length - 1; i >= 0; i--) items[i].dispose();
      items.length = 0;
    },
    get size() {
      return items.length;
    },
  };
}

function makeEngine(overrides?: Partial<GwenEngineBase>): GwenEngineBase {
  return {
    provide: vi.fn(),
    inject: vi.fn(),
    tryInject: vi.fn().mockReturnValue(undefined),
    hooks: makeHookBus(),
    logger: makeLogger(),
    run: vi.fn().mockImplementation((fn) => fn()),
    disposables: makeRegistry(),
    ...overrides,
  };
}

// ─── GwenEngineBase ───────────────────────────────────────────────────────────

describe("GwenEngineBase (structural)", () => {
  it("provide() can be called with key and value", () => {
    const engine = makeEngine();
    engine.provide("audio", { play: vi.fn() });
    expect(engine.provide).toHaveBeenCalledWith("audio", expect.anything());
  });

  it("inject() can be called with a key", () => {
    const engine = makeEngine({
      inject: vi.fn().mockReturnValue({ play: vi.fn() }),
    });
    const svc = engine.inject("audio");
    expect(svc).toBeDefined();
  });

  it("tryInject() returns undefined when absent", () => {
    const engine = makeEngine();
    expect(engine.tryInject("missing")).toBeUndefined();
  });

  it("hooks.hook() registers a listener", () => {
    const engine = makeEngine();
    const fn = vi.fn();
    engine.hooks.hook("engine:init", fn);
    expect(engine.hooks.hook).toHaveBeenCalledWith("engine:init", fn);
  });

  it("run() executes the provided function", () => {
    const engine = makeEngine();
    let ran = false;
    engine.run(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("disposables.add() + disposables.size work", () => {
    const engine = makeEngine();
    engine.disposables.add("my-resource", makeDisposable());
    expect(engine.disposables.size).toBe(1);
  });
});

// ─── GwenPlugin ───────────────────────────────────────────────────────────────

describe("GwenPlugin (structural)", () => {
  it("minimal plugin (name + setup) satisfies the interface", () => {
    const plugin: GwenPlugin = {
      name: "minimal",
      setup(_engine) {},
    };
    expect(plugin.name).toBe("minimal");
  });

  it("setup() receives GwenEngineBase and can call provide()", () => {
    const engine = makeEngine();
    const plugin: GwenPlugin = {
      name: "test",
      setup(e) {
        e.provide("service", {});
      },
    };
    plugin.setup(engine);
    expect(engine.provide).toHaveBeenCalledWith("service", {});
  });

  it("teardown() is optional and callable when present", () => {
    const teardown = vi.fn();
    const plugin: GwenPlugin = {
      name: "with-teardown",
      setup: vi.fn(),
      teardown,
    };
    plugin.teardown!();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("frame hooks are optional and receive dt in seconds", () => {
    const onBeforeUpdate = vi.fn();
    const onUpdate = vi.fn();
    const onAfterUpdate = vi.fn();
    const onRender = vi.fn();

    const plugin: GwenPlugin = {
      name: "frame-hooks",
      setup: vi.fn(),
      onBeforeUpdate,
      onUpdate,
      onAfterUpdate,
      onRender,
    };

    plugin.onBeforeUpdate!(0.016);
    plugin.onUpdate!(0.016);
    plugin.onAfterUpdate!(0.016);
    plugin.onRender!();

    expect(onBeforeUpdate).toHaveBeenCalledWith(0.016);
    expect(onUpdate).toHaveBeenCalledWith(0.016);
    expect(onAfterUpdate).toHaveBeenCalledWith(0.016);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("onError() receives the error and a PluginErrorContext", () => {
    let capturedError: unknown = null;
    let capturedContext: PluginErrorContext | null = null;

    const plugin: GwenPlugin = {
      name: "error-handler",
      setup: vi.fn(),
      onError(error, context) {
        capturedError = error;
        capturedContext = context;
      },
    };

    const ctx: PluginErrorContext = {
      phase: "onUpdate",
      frame: 42,
      recover: vi.fn(),
    };
    const err = new Error("boom");
    plugin.onError!(err, ctx);

    expect(capturedError).toBe(err);
    expect(capturedContext!.phase).toBe("onUpdate");
    expect(capturedContext!.frame).toBe(42);
  });

  it("PluginErrorContext.recover() can be called", () => {
    const recover = vi.fn();
    const ctx: PluginErrorContext = { phase: "onRender", frame: 1, recover };
    ctx.recover();
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
