/**
 * Engine lifecycle, plugin, config and memory errors use the grammar codes.
 */

import { afterEach, describe, expect, it } from "vitest";
import { GwenError, type GwenLogLevel, type IGwenLogProvider } from "@gwenjs/schema";
import { createEngine, type GwenEngine, type GwenEngineOptions } from "@gwenjs/core";
import { GwenConfigError } from "../../src/engine/config-error";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";
import { SharedMemoryManager } from "../../src/hooks/wasm/shared-memory";
import { entityIdFromString } from "../../src/engine/engine-api";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "fixture:svc": { ready: boolean };
  }
}

const engines: GwenEngine[] = [];

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function caught(run: () => void): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

function isGwen(error: unknown): error is GwenError {
  return error instanceof GwenError;
}

async function rejected(options: GwenEngineOptions): Promise<unknown> {
  let engine: GwenEngine | undefined;
  try {
    engine = await createEngine(options);
    engines.push(engine);
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("engine error grammar", () => {
  it("createEngine with maxEntities -1 throws GwenConfigError CORE:INVALID_CONFIG naming the field", async () => {
    const error = await rejected({ maxEntities: -1 });
    expect(error).toBeInstanceOf(GwenConfigError);
    if (!(error instanceof GwenConfigError)) return;
    expect(error.code).toBe("CORE:INVALID_CONFIG");
    expect(error.field).toBe("maxEntities");
    expect(error.composable).toBe("createEngine");
    expect(error.message).toContain('Invalid config "maxEntities": -1.');
  });

  it("boundaries — maxEntities 1 ok / 0 throws / 2_000_000 ok / 2_000_001 throws; targetFPS 1 ok / 0 / 300 ok / 301 throws; maxDeltaSeconds 0.001 ok / 10 ok / 0 throws / 10.001 throws", async () => {
    const accepted: GwenEngineOptions[] = [
      { maxEntities: 1 },
      { maxEntities: 2_000_000 },
      { targetFPS: 1 },
      { targetFPS: 300 },
      { maxDeltaSeconds: 0.001 },
      { maxDeltaSeconds: 10 },
    ];
    for (const options of accepted) {
      const engine = await createEngine(options);
      engines.push(engine);
      expect(engine.state).toBe("idle");
    }

    const rejectedCases: { options: GwenEngineOptions; field: string }[] = [
      { options: { maxEntities: 0 }, field: "maxEntities" },
      { options: { maxEntities: 2_000_001 }, field: "maxEntities" },
      { options: { targetFPS: 0 }, field: "targetFPS" },
      { options: { targetFPS: 301 }, field: "targetFPS" },
      { options: { maxDeltaSeconds: 0 }, field: "maxDeltaSeconds" },
      { options: { maxDeltaSeconds: 10.001 }, field: "maxDeltaSeconds" },
    ];
    for (const { options, field } of rejectedCases) {
      const error = await rejected(options);
      expect(error).toBeInstanceOf(GwenConfigError);
      if (!(error instanceof GwenConfigError)) return;
      expect(error.code).toBe("CORE:INVALID_CONFIG");
      expect(error.field).toBe(field);
    }
  });

  it("invalid logger.minLevel and logger.providers throw CORE:INVALID_CONFIG with the field name", async () => {
    const level = await rejected({ logger: { minLevel: "verbose" as GwenLogLevel } });
    expect(level).toBeInstanceOf(GwenConfigError);
    if (!(level instanceof GwenConfigError)) return;
    expect(level.code).toBe("CORE:INVALID_CONFIG");
    expect(level.field).toBe("logger.minLevel");

    const bad = await rejected({
      logger: { providers: [{} as IGwenLogProvider] },
    });
    expect(bad).toBeInstanceOf(GwenConfigError);
    if (!(bad instanceof GwenConfigError)) return;
    expect(bad.code).toBe("CORE:INVALID_CONFIG");
    expect(bad.field).toBe("logger.providers");
  });

  it("inject of a missing service throws CORE:PLUGIN_NOT_FOUND naming engine.inject and no plugin factory", async () => {
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    const error = caught(() => {
      engine.inject("fixture:svc");
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:PLUGIN_NOT_FOUND");
    expect(error.composable).toBe("engine.inject");
    expect(error.message).toContain('No plugin provides service "fixture:svc".');
    expect(error.message).not.toContain("Plugin()");
    expect(error.docsUrl.endsWith("#core-plugin-not-found")).toBe(true);
    if (__GWEN_DEV__) {
      expect(error.hint).toContain('provides: ["fixture:svc"]');
      expect(error.hint).not.toContain("Plugin()");
    }
  });

  it("use() while faulted throws CORE:INVALID_STATE_TRANSITION naming engine.use", async () => {
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    await engine.startExternal();
    engine.errors.emit({ level: "fatal", code: "TEST:FATAL", message: "down" });
    let error: unknown;
    try {
      await engine.use({ name: "late", setup() {} });
    } catch (caughtError) {
      error = caughtError;
    }
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:INVALID_STATE_TRANSITION");
    expect(error.composable).toBe("engine.use");
    expect(error.message).toContain("Not allowed while the engine is faulted.");
  });

  it("a re-entrant advance throws CORE:ADVANCE_REENTRANT naming engine.advance", async () => {
    const engine = await createEngine({ maxEntities: 8 });
    engines.push(engine);
    let error: unknown;
    engine.hooks.hook("engine:before-update", () => {
      return engine.advance(0).then(
        () => undefined,
        (caughtError: unknown) => {
          error = caughtError;
        },
      );
    });
    await engine.advance(1 / 60);
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:ADVANCE_REENTRANT");
    expect(error.composable).toBe("engine.advance");
  });

  it.runIf(!__GWEN_DEV__)("the config hint is absent in production", async () => {
    const error = await rejected({ maxEntities: -1 });
    expect(error).toBeInstanceOf(GwenConfigError);
    if (!(error instanceof GwenConfigError)) return;
    expect(error.hint).toBeUndefined();
    expect(error.message).not.toContain("Fix:");
  });

  it.runIf(__GWEN_DEV__)("the config hint is present in development", async () => {
    const error = await rejected({ maxEntities: -1 });
    expect(error).toBeInstanceOf(GwenConfigError);
    if (!(error instanceof GwenConfigError)) return;
    expect(error.hint).toBe("Must be a positive integer. Try 10_000 for a typical game.");
    expect(error.message).toContain("Fix:");
  });

  it("entityIdFromString names its composable", () => {
    const error = caught(() => {
      entityIdFromString("5,42");
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:INVALID_ENTITY_ID");
    expect(error.composable).toBe("entityIdFromString");
    expect(error.message).not.toContain("[GWEN]");
  });

  it("SharedMemoryManager.create without a bridge drops the [GWEN:SharedMemory] tag", () => {
    const error = caught(() => {
      SharedMemoryManager.create(new WasmBridgeImpl(), 8);
    });
    expect(isGwen(error)).toBe(true);
    if (!isGwen(error)) return;
    expect(error.code).toBe("CORE:WASM_NOT_INITIALIZED");
    expect(error.composable).toBe("SharedMemoryManager.create");
    expect(error.message).not.toContain("[GWEN:SharedMemory]");
    expect(error.message).not.toContain("[GWEN]");
  });
});
