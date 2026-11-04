/**
 * @gwenjs/kit — definePlugin() unit tests (RFC-002).
 *
 * Tests the factory-function API: `definePlugin(factory)` returns a typed
 * factory. Calling that factory (with or without options) produces a plain
 * plugin object conforming to `GwenPlugin`.
 */

import { describe, it, expect, vi } from "vitest";
import { definePlugin } from "../src/plugin";
import type { GwenConfigIssue, GwenEngineBase as GwenEngine, IGwenLogger } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: { gravity: number };
    x: { n: number };
    y: { n: number };
    a: { n: number };
    b: { n: number };
    audio: { n: number };
    errors: { n: number };
    "wasm:bridge": { n: number };
    memory: { n: number };
  }
}

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
    inject(key): never {
      throw new Error(String(key));
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
    let captured: Readonly<{ volume: number }> = { volume: 0 };
    const P = definePlugin({ provides: [], options: { defaults: { volume: 1 } } }, (opts) => {
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

  it("a factory that returns a frozen object throws a TypeError at the factory call", () => {
    const bare = definePlugin(() => Object.freeze({ name: "Bare", setup() {} }));
    expect(() => bare()).toThrow(TypeError);

    const declared = definePlugin({ provides: ["x"] }, () =>
      Object.freeze({ name: "Declared", setup() {} }),
    );
    expect(() => declared()).toThrow(TypeError);
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
    let received: Readonly<{ x: number }> = { x: -1 };
    const P = definePlugin({ provides: [], options: { defaults: { x: 0 } } }, (opts) => {
      received = opts;
      return { name: "P", setup: vi.fn() };
    });
    P();
    expect(received.x).toBe(0);
    P({ x: 42 });
    expect(received.x).toBe(42);
  });

  it("required options — Plugin(opts) passes values to factory", () => {
    let seen: number | undefined;
    const P = definePlugin({ provides: [], options: { defaults: { speed: 0 } } }, (opts) => ({
      name: "Mover",
      setup(_engine: GwenEngine) {
        seen = opts.speed;
      },
    }));
    P({ speed: 5 }).setup(plainEngine());
    expect(seen).toBe(5);
  });

  it("multiple independent instances from same factory", () => {
    const P = definePlugin({ provides: [], options: { defaults: { id: "" } } }, (opts) => ({
      name: `Plugin-${opts.id}`,
      setup() {},
    }));
    const p1 = P({ id: "alpha" });
    const p2 = P({ id: "beta" });
    expect(p1.name).toBe("Plugin-alpha");
    expect(p2.name).toBe("Plugin-beta");
  });
});

// ─── Declaration form ─────────────────────────────────────────────────────────

describe("definePlugin() — declaration form", () => {
  it("shallow merge and an undefined input keeps its default", () => {
    type Options = { gravity: number; scale: number | undefined };
    const defaults: Options = { gravity: -9.8, scale: 1 };
    let received: Readonly<Options> = { gravity: Number.NaN, scale: undefined };
    const P = definePlugin({ provides: ["physics2d"], options: { defaults } }, (options) => {
      received = options;
      return { name: "Physics", setup() {} };
    });

    expect(() => P({ gravity: -20, scale: undefined })).not.toThrow();
    expect(received).toEqual({ gravity: -20, scale: 1 });
    expect(P({ gravity: -20 }).provides).toEqual(["physics2d"]);
  });

  it("resolved options are frozen", () => {
    type Options = { gravity: number };
    let received: Readonly<Record<string, unknown>> = { unset: true };
    const P = definePlugin(
      { provides: ["physics2d"], options: { defaults: { gravity: -9.8 } } },
      (options: Readonly<Options>) => {
        received = options;
        return { name: "Physics", setup() {} };
      },
    );

    expect(() => P({ gravity: 3 })).not.toThrow();
    const plugin = P({ gravity: 3 });
    expect(received).toEqual({ gravity: 3 });
    expect(Object.isFrozen(received)).toBe(true);
    expect(Reflect.set(received, "gravity", 1)).toBe(false);
    expect(received).toEqual({ gravity: 3 });
    expect(plugin.provides).toEqual(["physics2d"]);
    expect(Object.isFrozen(plugin.provides)).toBe(true);
  });

  it("the function form of provides is resolved and deduplicated", () => {
    const P = definePlugin(
      { provides: () => ["a", "a", "b", "a"], options: { defaults: {} } },
      () => ({ name: "Dup", setup() {} }),
    );

    expect(() => P()).not.toThrow();
    const plugin = P();
    expect(plugin.provides).toEqual(["a", "b"]);
    expect(Object.isFrozen(plugin.provides)).toBe(true);
  });

  it("the function form of provides reads the resolved options", () => {
    const Off = definePlugin(
      {
        provides: (options) => (options.audio ? ["audio"] : []),
        options: { defaults: { audio: false } },
      },
      () => ({ name: "Off", setup() {} }),
    );
    const On = definePlugin(
      {
        provides: (options) => (options.audio ? ["audio"] : []),
        options: { defaults: { audio: true } },
      },
      () => ({ name: "On", setup() {} }),
    );

    expect(() => Off({ audio: true })).not.toThrow();
    expect(Off({ audio: true }).provides).toEqual(["audio"]);
    expect(Off().provides).toEqual([]);
    expect(On({}).provides).toEqual(["audio"]);
  });

  it("setup keeps its identity", () => {
    const setup = (): void => {};
    const teardown = (): void => {};
    const onError = (): void => {};
    const Bare = definePlugin(() => ({ name: "Bare", setup, teardown, onError }));
    const Services = definePlugin({ provides: ["x"] }, () => ({
      name: "Services",
      setup,
      teardown,
      onError,
    }));
    const WithOptions = definePlugin({ provides: ["x"], options: { defaults: {} } }, () => ({
      name: "WithOptions",
      setup,
      teardown,
      onError,
    }));

    expect(() => Services()).not.toThrow();
    expect(() => WithOptions()).not.toThrow();
    for (const plugin of [Bare(), Services(), WithOptions()]) {
      expect(plugin.setup).toBe(setup);
      expect(plugin.teardown).toBe(teardown);
      expect(plugin.onError).toBe(onError);
    }
  });

  it("invalid options do not throw at the factory call", () => {
    type Options = { bad: boolean };
    const issue: GwenConfigIssue = {
      path: "bad",
      expected: "false",
      received: "true",
      owner: "physics2d",
    };
    let validations = 0;
    let validated: Readonly<Record<string, unknown>> = { unset: true };
    const P = definePlugin(
      {
        provides: [],
        options: {
          defaults: { bad: false },
          validate(options: Readonly<Options>) {
            validations += 1;
            validated = options;
            return options.bad ? [issue] : [];
          },
        },
      },
      () => ({ name: "Strict", setup() {} }),
    );

    expect(() => P({ bad: true })).not.toThrow();
    const plugin = P({ bad: true });
    expect(validations).toBe(0);
    expect(plugin.validateOptions()).toEqual([issue]);
    expect(validations).toBe(1);
    expect(validated).toEqual({ bad: true });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(P().validateOptions()).toEqual([]);
  });

  it("overload 1 gives provides [] and validateOptions []", () => {
    const P = definePlugin(() => ({ name: "Bare", setup() {} }));

    expect(() => P()).not.toThrow();
    const plugin = P();
    expect(plugin.provides).toEqual([]);
    expect(plugin.validateOptions()).toEqual([]);
    expect(Object.isFrozen(plugin.provides)).toBe(true);
  });

  it("overload 2 declares provides and validateOptions returns []", () => {
    const P = definePlugin({ provides: ["x"] }, () => ({ name: "Services", setup() {} }));

    expect(() => P()).not.toThrow();
    const plugin = P();
    expect(plugin.provides).toEqual(["x"]);
    expect(plugin.validateOptions()).toEqual([]);
    expect(Object.keys(plugin)).toEqual(
      expect.arrayContaining(["name", "setup", "provides", "validateOptions"]),
    );
  });

  it("empty defaults {} with no input resolves {}", () => {
    let received: Readonly<Record<string, unknown>> = { unset: true };
    const P = definePlugin({ provides: [], options: { defaults: {} } }, (options) => {
      received = options;
      return { name: "Empty", setup() {} };
    });

    expect(() => P()).not.toThrow();
    expect(received).toEqual({});
    expect(Object.keys(received)).toEqual([]);
    expect(Object.isFrozen(received)).toBe(true);
  });

  it("provides: [] with options is allowed", () => {
    const P = definePlugin({ provides: [], options: { defaults: { n: 1 } } }, () => ({
      name: "Quiet",
      setup() {},
    }));

    expect(() => P({ n: 2 })).not.toThrow();
    const plugin = P({ n: 2 });
    expect(plugin.provides).toEqual([]);
    expect(plugin.validateOptions()).toEqual([]);
  });

  it("a declaration with two keys keeps both in order", () => {
    const P = definePlugin({ provides: ["y", "x"], options: { defaults: { n: 1 } } }, () => ({
      name: "Two",
      setup() {},
    }));

    expect(() => P()).not.toThrow();
    expect(P().provides).toEqual(["y", "x"]);
  });

  it("nested object input replaces the nested default whole", () => {
    type Options = { pos: { x: number; y?: number } };
    const defaults: Options = { pos: { x: 1, y: 2 } };
    let received: Readonly<Record<string, unknown>> = { unset: true };
    const P = definePlugin({ provides: [], options: { defaults } }, (options) => {
      received = options;
      return { name: "Nested", setup() {} };
    });

    expect(() => P({ pos: { x: 9 } })).not.toThrow();
    expect(received).toEqual({ pos: { x: 9 } });
    expect(received.pos).toEqual({ x: 9 });
  });

  it("two instances from the same factory are independent", () => {
    type Options = { n: number };
    const provided: "x"[] = ["x"];
    const seen: Readonly<Options>[] = [];
    const P = definePlugin({ provides: provided, options: { defaults: { n: 0 } } }, (options) => {
      seen.push(options);
      return { name: "Twin", setup() {} };
    });

    expect(() => P({ n: 1 })).not.toThrow();
    seen.length = 0;
    const a = P({ n: 1 });
    const b = P({ n: 2 });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    expect(seen.every((options) => Object.isFrozen(options))).toBe(true);
    expect(a).not.toBe(b);
    expect(a.provides).toEqual(["x"]);
    expect(b.provides).toEqual(["x"]);
    expect(a.provides).not.toBe(b.provides);
    expect(a.provides).not.toBe(provided);
    expect(Object.isFrozen(provided)).toBe(false);
    expect(provided).toEqual(["x"]);
  });

  it("overload 1 passes the caller's argument through to the factory", () => {
    let received: unknown = "unset";
    const P = definePlugin((input?: unknown) => {
      received = input;
      return { name: "Raw", setup() {} };
    });

    const plugin = Reflect.apply(P, undefined, [{ v: 1 }]);
    expect(received).toEqual({ v: 1 });
    expect(plugin.provides).toEqual([]);
  });

  it("a non-object argument is ignored and the defaults apply", () => {
    let received: Readonly<Record<string, unknown>> = { unset: true };
    const P = definePlugin({ provides: [], options: { defaults: { n: 1 } } }, (options) => {
      received = options;
      return { name: "Defaults", setup() {} };
    });

    expect(() => Reflect.apply(P, undefined, [null])).not.toThrow();
    expect(received).toEqual({ n: 1 });
  });

  it("a factory that returns the same object twice can be called twice", () => {
    const shared = { name: "Shared", setup() {} };
    const P = definePlugin({ provides: ["x"] }, () => shared);

    expect(() => P()).not.toThrow();
    expect(() => P()).not.toThrow();
    expect(P()).toBe(shared);
    expect(shared).toHaveProperty("provides", ["x"]);
  });
});
