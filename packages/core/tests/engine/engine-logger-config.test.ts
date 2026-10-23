/**
 * Engine logger built from GwenEngineOptions.logger and debug.
 */
import { describe, expect, it } from "vitest";
import type { GwenLogEntry, GwenLogLevel, IGwenLogProvider } from "@gwenjs/schema";
import { createEngine, GwenConfigError, type GwenEngine, type GwenPlugin } from "../../src/index";

function captureProvider(): { seen: GwenLogEntry[]; provider: IGwenLogProvider } {
  const seen: GwenLogEntry[] = [];
  return {
    seen,
    provider: {
      handle(entry) {
        seen.push(entry);
      },
    },
  };
}

async function withEngine(
  options: Parameters<typeof createEngine>[0],
  body: (engine: GwenEngine) => void | Promise<void>,
): Promise<void> {
  const engine = await createEngine(options);
  try {
    await body(engine);
  } finally {
    await engine.stop();
  }
}

/** Console.warn calls made by one logger.warn on a fresh engine. */
async function warnCalls(options: Parameters<typeof createEngine>[0]): Promise<unknown[][]> {
  const calls: unknown[][] = [];
  const previous = console.warn;
  const engine = await createEngine(options);
  console.warn = (...args) => {
    calls.push(args);
  };
  try {
    engine.inject("logger").warn("ping");
    return calls;
  } finally {
    console.warn = previous;
    await engine.stop();
  }
}

describe("createEngine logger", () => {
  it("engine internals log through the configured provider", async () => {
    const { seen, provider } = captureProvider();
    const plugin: GwenPlugin = {
      name: "bad-setup-plugin",
      setup() {
        throw new Error("setup exploded");
      },
    };
    await withEngine({ logger: { providers: [provider], minLevel: "debug" } }, async (engine) => {
      await expect(engine.use(plugin)).rejects.toThrow("setup exploded");
      expect(seen).toEqual(
        expect.arrayContaining([expect.objectContaining({ level: "error", tag: "gwen:core" })]),
      );
    });
  });

  it("the logger service is the configured logger", async () => {
    const { seen, provider } = captureProvider();
    await withEngine({ logger: { providers: [provider], minLevel: "debug" } }, (engine) => {
      engine.inject("logger").error("x");
      expect(seen).toEqual([
        expect.objectContaining({ level: "error", message: "x", tag: "gwen:core" }),
      ]);
    });
  });

  it("debug true lowers the default minimum level", async () => {
    const { seen, provider } = captureProvider();
    await withEngine({ debug: true, logger: { providers: [provider] } }, (engine) => {
      engine.inject("logger").debug("d");
      expect(seen.filter((entry) => entry.message === "d").map((entry) => entry.level)).toEqual([
        "debug",
      ]);
    });
  });

  it("debug false does not deliver debug", async () => {
    const { seen, provider } = captureProvider();
    await withEngine({ debug: false, logger: { providers: [provider] } }, (engine) => {
      engine.inject("logger").debug("d");
      engine.inject("logger").warn("w");
      expect(seen.map((entry) => `${entry.level}:${entry.message}`)).toEqual(["warn:w"]);
    });
  });

  it("logger.minLevel wins over debug", async () => {
    const { seen, provider } = captureProvider();
    await withEngine(
      { debug: true, logger: { providers: [provider], minLevel: "error" } },
      (engine) => {
        engine.inject("logger").warn("w");
        engine.inject("logger").error("e");
        expect(seen.map((entry) => entry.level)).toEqual(["error"]);
      },
    );
  });

  it("minLevel error drops warn", async () => {
    const { seen, provider } = captureProvider();
    await withEngine({ logger: { providers: [provider], minLevel: "error" } }, (engine) => {
      engine.inject("logger").warn("w");
      engine.inject("logger").error("e");
      expect(seen.map((entry) => entry.level)).toEqual(["error"]);
    });
  });

  it("a throwing provider does not stop the others", async () => {
    const delivered: GwenLogEntry[] = [];
    const providers: IGwenLogProvider[] = [
      {
        handle() {
          throw new Error("provider failed");
        },
      },
      {
        handle(entry) {
          delivered.push(entry);
        },
      },
    ];
    await withEngine({ logger: { providers, minLevel: "debug" } }, (engine) => {
      engine.inject("logger").error("kept");
      expect(delivered.map((entry) => entry.message)).toEqual(["kept"]);
    });
  });

  it("an unknown logger.minLevel throws GWEN_CONFIG_ERROR", async () => {
    let engine: GwenEngine | undefined;
    let caught: unknown;
    try {
      engine = await createEngine({
        logger: { minLevel: "verbose" as GwenLogLevel },
      });
    } catch (error: unknown) {
      caught = error;
    } finally {
      await engine?.stop();
    }
    const error = caught instanceof GwenConfigError ? caught : undefined;
    expect({
      code: error?.code,
      field: error?.field,
      hint: error?.hint,
    }).toEqual({
      code: "GWEN_CONFIG_ERROR",
      field: "logger.minLevel",
      hint: 'Use "debug", "info", "warn" or "error".',
    });
  });

  it("a provider without handle throws GWEN_CONFIG_ERROR", async () => {
    let engine: GwenEngine | undefined;
    let caught: unknown;
    try {
      engine = await createEngine({
        logger: { providers: [{} as IGwenLogProvider] },
      });
    } catch (error: unknown) {
      caught = error;
    } finally {
      await engine?.stop();
    }
    const error = caught instanceof GwenConfigError ? caught : undefined;
    expect({
      code: error?.code,
      field: error?.field,
      hint: error?.hint,
    }).toEqual({
      code: "GWEN_CONFIG_ERROR",
      field: "logger.providers",
      hint: "Pass objects with a handle(entry) method.",
    });
  });

  it("an empty providers array is accepted", async () => {
    const calls = await warnCalls({ logger: { providers: [] } });
    expect(calls).toEqual([]);
  });

  it("logger empty object behaves as no logger", async () => {
    const fromEmpty = await warnCalls({ logger: {} });
    const fromOmitted = await warnCalls(undefined);
    expect([fromEmpty, fromOmitted]).toEqual([
      [["[gwen:core]", "ping", "frame=0"]],
      [["[gwen:core]", "ping", "frame=0"]],
    ]);
  });

  it("two engines do not cross-deliver", async () => {
    const captureA = captureProvider();
    const captureB = captureProvider();
    let engineA: GwenEngine | undefined;
    let engineB: GwenEngine | undefined;
    try {
      engineA = await createEngine({
        logger: { providers: [captureA.provider], minLevel: "error" },
      });
      engineB = await createEngine({
        logger: { providers: [captureB.provider], minLevel: "error" },
      });
      engineA.inject("logger").error("from-a");
      expect([
        captureA.seen.map((entry) => entry.message),
        captureB.seen.map((entry) => entry.message),
      ]).toEqual([["from-a"], []]);
    } finally {
      await engineB?.stop();
      await engineA?.stop();
    }
  });
});
