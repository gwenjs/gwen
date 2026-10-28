import { describe, expect, it } from "vitest";
import * as schema from "../src/index.ts";

describe("engine config", () => {
  it("ENGINE_DEFAULTS has the documented values and is frozen", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(schema.ENGINE_DEFAULTS).toEqual({
      maxEntities: 10_000,
      targetFPS: 60,
      maxDeltaSeconds: 0.1,
      loop: "internal",
      physicsHz: 0,
      maxCatchupSteps: 2,
      debug: false,
    });
    expect(Object.isFrozen(schema.ENGINE_DEFAULTS)).toBe(true);
  });

  it("checkEngineConfig accepts the boundary values", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(schema.checkEngineConfig({})).toEqual([]);
    expect(schema.checkEngineConfig({ maxEntities: 1 })).toEqual([]);
    expect(schema.checkEngineConfig({ maxEntities: 2_000_000 })).toEqual([]);
    expect(schema.checkEngineConfig({ targetFPS: 1 })).toEqual([]);
    expect(schema.checkEngineConfig({ targetFPS: 300 })).toEqual([]);
    expect(schema.checkEngineConfig({ maxDeltaSeconds: 10 })).toEqual([]);
  });

  it("checkEngineConfig rejects max+1 and zero with path, expected and received", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const rows: ReadonlyArray<{
      input: Record<string, unknown>;
      path: string;
      expected: string;
      received: string;
    }> = [
      {
        input: { maxEntities: 2_000_001 },
        path: "maxEntities",
        expected: "an integer in [1, 2000000]",
        received: "2000001",
      },
      {
        input: { maxEntities: 0 },
        path: "maxEntities",
        expected: "an integer in [1, 2000000]",
        received: "0",
      },
      {
        input: { maxEntities: 1.5 },
        path: "maxEntities",
        expected: "an integer in [1, 2000000]",
        received: "1.5",
      },
      {
        input: { targetFPS: 301 },
        path: "targetFPS",
        expected: "a number in [1, 300]",
        received: "301",
      },
      {
        input: { targetFPS: 0 },
        path: "targetFPS",
        expected: "a number in [1, 300]",
        received: "0",
      },
      {
        input: { maxDeltaSeconds: 10.0001 },
        path: "maxDeltaSeconds",
        expected: "a finite number in (0, 10]",
        received: "10.0001",
      },
      {
        input: { maxDeltaSeconds: 0 },
        path: "maxDeltaSeconds",
        expected: "a finite number in (0, 10]",
        received: "0",
      },
      {
        input: { maxDeltaSeconds: -0 },
        path: "maxDeltaSeconds",
        expected: "a finite number in (0, 10]",
        received: "-0",
      },
    ];
    for (const row of rows) {
      expect(schema.checkEngineConfig(row.input)).toEqual([
        {
          path: row.path,
          expected: row.expected,
          received: row.received,
          owner: "@gwenjs/schema",
        },
      ]);
    }
  });

  it("checkEngineConfig reports every invalid field, in field order", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const issues = schema.checkEngineConfig({
      debug: 1,
      jsUrl: "x",
      maxCatchupSteps: -1,
      physicsHz: -1,
      loop: "fixed",
      variant: "nope",
      maxDeltaSeconds: 0,
      targetFPS: 0,
      maxEntities: 0,
    });
    expect(issues.map((issue) => issue.path)).toEqual([
      "maxEntities",
      "targetFPS",
      "maxDeltaSeconds",
      "variant",
      "loop",
      "physicsHz",
      "maxCatchupSteps",
      "debug",
    ]);
  });

  it('loop "fixed" is an issue with expected \'"internal" | "external"\'', () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(schema.checkEngineConfig({ loop: "fixed" })).toEqual([
      {
        path: "loop",
        expected: '"internal" | "external"',
        received: '"fixed"',
        owner: "@gwenjs/schema",
      },
    ]);
  });

  it("checkEngineConfig ignores keys that are not engine fields", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(
      schema.checkEngineConfig({
        maxEntities: 1,
        targetFPS: undefined,
        jsUrl: "x",
        wasmUrl: "y",
        glue: {},
        wasmInstance: "isolated",
        queryCacheSize: 4,
        _bridge: {},
      }),
    ).toEqual([]);
  });

  it("checkEngineConfig never throws and formatReceived is stable", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, "maxEntities", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const samples: ReadonlyArray<Record<string, unknown>> = [
      throwing,
      { maxEntities: 1n },
      { maxEntities: Symbol("s") },
      { maxEntities: circular },
      { debug: proxy },
    ];
    for (const input of samples) {
      let thrown = false;
      try {
        schema.checkEngineConfig(input);
      } catch {
        thrown = true;
      }
      expect(thrown).toBe(false);
    }
    expect(schema.checkEngineConfig(throwing)).toEqual([
      {
        path: "maxEntities",
        expected: "an integer in [1, 2000000]",
        received: "[unreadable]",
        owner: "@gwenjs/schema",
      },
    ]);
    expect(schema.checkEngineConfig({ maxEntities: 1n })[0]?.received).toBe("[bigint]");
    expect(schema.checkEngineConfig({ targetFPS: Symbol("s") })[0]?.received).toBe("[symbol]");
    expect(schema.checkEngineConfig({ maxDeltaSeconds: circular })[0]?.received).toBe("[circular]");

    let proxyThrown = false;
    let proxyIssues: ReturnType<typeof schema.checkEngineConfig> = [];
    try {
      proxyIssues = schema.checkEngineConfig({ debug: proxy });
    } catch {
      proxyThrown = true;
    }
    expect(proxyThrown).toBe(false);
    expect(proxyIssues).toEqual([
      {
        path: "debug",
        expected: "a boolean",
        received: "[unreadable]",
        owner: "@gwenjs/schema",
      },
    ]);
    let proxyText = "";
    let formatThrew = false;
    try {
      proxyText = schema.formatReceived(proxy);
    } catch {
      formatThrew = true;
    }
    expect(formatThrew).toBe(false);
    expect(proxyText).toBe("[unreadable]");

    class Foo {}
    expect(schema.formatReceived(() => undefined)).toBe("[function]");
    expect(schema.formatReceived(new Foo())).toBe("[object Foo]");
    expect(schema.formatReceived(Number.NaN)).toBe("NaN");
    expect(schema.formatReceived(Number.POSITIVE_INFINITY)).toBe("Infinity");
    expect(schema.formatReceived(Number.NEGATIVE_INFINITY)).toBe("-Infinity");
    expect(schema.formatReceived(-0)).toBe("-0");
    expect(schema.formatReceived(circular)).toBe("[circular]");
    expect(schema.formatReceived([1, "a", true])).toBe('[1,"a",true]');
    expect(schema.formatReceived({ b: 1, a: true })).toBe('{"b":1,"a":true}');
  });

  it("checkEngineConfig owner defaults and prefix", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(schema.checkEngineConfig({ maxEntities: 0 })).toEqual([
      {
        path: "maxEntities",
        expected: "an integer in [1, 2000000]",
        received: "0",
        owner: "@gwenjs/schema",
      },
    ]);
    expect(schema.checkEngineConfig({ maxEntities: 0 }, "@gwenjs/app", "engine.")).toEqual([
      {
        path: "engine.maxEntities",
        expected: "an integer in [1, 2000000]",
        received: "0",
        owner: "@gwenjs/app",
      },
    ]);
  });
});
