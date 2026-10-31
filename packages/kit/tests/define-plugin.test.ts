/**
 * @gwenjs/kit — definePlugin() unit tests (RFC-002).
 *
 * Tests the factory-function API: `definePlugin(factory)` returns a typed
 * factory. Calling that factory (with or without options) produces a plain
 * plugin object conforming to `GwenPlugin`.
 */

import { describe, it, expect, vi } from "vitest";
import { definePlugin } from "../src/plugin";
import type { GwenEngineBase as GwenEngine, IGwenLogger } from "@gwenjs/schema";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a minimal `GwenEngine`-compatible mock for use in plugin tests.
 * All methods are replaced with `vi.fn()` stubs.
 */
function mockEngine(): GwenEngine {
  return {
    provide: vi.fn(),
    inject: vi.fn(),
    tryInject: vi.fn(),
    use: vi.fn(),
    unuse: vi.fn(),
    hooks: { hook: vi.fn(), callHook: vi.fn() },
  } as unknown as GwenEngine;
}

function plainEngine(): GwenEngine {
  const logger: IGwenLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return logger;
    },
  };
  return {
    provide() {},
    inject(): undefined {
      return undefined;
    },
    tryInject(): undefined {
      return undefined;
    },
    hooks: {
      hook() {},
      removeHook() {},
    },
    logger,
    run<T>(fn: () => T): T {
      return fn();
    },
    disposables: {
      add() {},
      disposeAll() {},
      size: 0,
    },
  };
}

// ─── TS-only plugin ───────────────────────────────────────────────────────────

describe("definePlugin() — TS-only plugin", () => {
  it("returns a factory function", () => {
    const MyPlugin = definePlugin(() => ({ name: "MyPlugin", setup: vi.fn() }));
    expect(typeof MyPlugin).toBe("function");
  });

  it("calling the factory returns a defined plugin object", () => {
    const MyPlugin = definePlugin(() => ({ name: "MyPlugin", setup: vi.fn() }));
    expect(MyPlugin()).toBeDefined();
  });

  it("instance name matches the definition", () => {
    const MyPlugin = definePlugin(() => ({ name: "MyPlugin", setup: vi.fn() }));
    const p = MyPlugin();
    expect(p.name).toBe("MyPlugin");
  });

  it("plugin has no wasm property", () => {
    const P = definePlugin(() => ({ name: "P", setup: vi.fn() }));
    expect((P() as { wasm?: unknown }).wasm).toBeUndefined();
  });

  it("setup() is called with the engine argument", () => {
    const setup = vi.fn();
    const P = definePlugin(() => ({ name: "P", setup }));
    const engine = mockEngine();
    P().setup(engine);
    expect(setup).toHaveBeenCalledWith(engine);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  it("setup() can call engine.provide()", () => {
    const engine = mockEngine();
    const P = definePlugin(() => ({
      name: "P",
      setup(e: GwenEngine) {
        (e as ReturnType<typeof mockEngine>).provide("audio" as never, {} as never);
      },
    }));
    P().setup(engine);
    expect((engine as ReturnType<typeof mockEngine>).provide).toHaveBeenCalledTimes(1);
  });

  it("teardown() is called", () => {
    const teardown = vi.fn();
    const P = definePlugin(() => ({ name: "P", setup: vi.fn(), teardown }));
    P().teardown!();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("options are forwarded to the factory", () => {
    let captured: { volume?: number } = {};
    const P = definePlugin((opts: { volume?: number } = {}) => {
      captured = opts;
      return { name: "P", setup: vi.fn() };
    });
    P({ volume: 0.5 });
    expect(captured.volume).toBe(0.5);
  });

  it("each factory call produces independent closure state", () => {
    const seen: number[] = [];
    const P = definePlugin(() => {
      let count = 0;
      return {
        name: "Counter",
        setup(_engine: GwenEngine) {
          count += 1;
          seen.push(count);
        },
      };
    });

    const p1 = P();
    const p2 = P();
    p1.setup(plainEngine());
    p1.setup(plainEngine());
    p2.setup(plainEngine());

    expect(seen).toEqual([1, 2, 1]);
  });

  it("setup closure state persists across lifecycle calls", () => {
    const log: string[] = [];
    const P = definePlugin(() => ({
      name: "Stateful",
      setup(_e: GwenEngine) {
        log.push("setup");
      },
      teardown() {
        log.push("teardown");
      },
    }));

    const p = P();
    p.setup(plainEngine());
    p.teardown!();

    expect(log).toEqual(["setup", "teardown"]);
  });
});

describe("definePlugin() — setup", () => {
  it("the factory returns the factory object unchanged", () => {
    const setup = (): void => {};
    const plugin = { name: "P", setup };
    const P = definePlugin(() => plugin);
    expect(P().setup).toBe(setup);
  });

  it("a throwing setup propagates the same error instance", async () => {
    const cause = new Error("x");
    const P = definePlugin(() => ({
      name: "Broken",
      setup(_engine: GwenEngine) {
        throw cause;
      },
    }));
    let thrown: unknown;
    try {
      await P().setup(plainEngine());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(cause);
  });
});

// ─── Options variants ─────────────────────────────────────────────────────────

describe("definePlugin() — options variants", () => {
  it("void options — Plugin() with no args", () => {
    const P = definePlugin(() => ({ name: "P", setup: vi.fn() }));
    expect(() => P()).not.toThrow();
  });

  it("optional options — Plugin() OR Plugin(opts)", () => {
    let received: { x?: number } | undefined;
    const P = definePlugin((opts?: { x?: number }) => {
      received = opts;
      return { name: "P", setup: vi.fn() };
    });
    P();
    expect(received).toBeUndefined();
    P({ x: 42 });
    expect(received?.x).toBe(42);
  });

  it("required options — Plugin(opts) passes values to factory", () => {
    let seen: number | undefined;
    const P = definePlugin((opts: { speed?: number } = {}) => ({
      name: "Mover",
      setup(_engine: GwenEngine) {
        seen = opts.speed;
      },
    }));
    P({ speed: 5 }).setup(plainEngine());
    expect(seen).toBe(5);
  });

  it("multiple independent instances from same factory", () => {
    const P = definePlugin((opts: { id?: string } = {}) => ({
      name: `Plugin-${opts.id ?? ""}`,
      setup() {},
    }));
    const p1 = P({ id: "alpha" });
    const p2 = P({ id: "beta" });
    expect(p1.name).toBe("Plugin-alpha");
    expect(p2.name).toBe("Plugin-beta");
  });
});
