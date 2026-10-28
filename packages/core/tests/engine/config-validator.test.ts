/**
 * @file Tests for SAFETY-01 Phase 1 — GwenConfigError and validateEngineConfig.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as schema from "@gwenjs/schema";
import type { IGwenLogProvider } from "@gwenjs/schema";
import { validateEngineConfig } from "../../src/engine/engine-config-validator.js";
import { GwenConfigError } from "../../src/engine/config-error.js";
import { createEngine, type GwenEngine } from "../../src/index";

describe("GwenConfigError", () => {
  it("is an Error instance", () => {
    const err = new GwenConfigError("maxEntities", -1, { hint: "Must be positive" });
    expect(err).toBeInstanceOf(Error);
  });

  it("has name property set to GwenConfigError", () => {
    const err = new GwenConfigError("maxEntities", -1, { hint: "Must be positive" });
    expect(err.name).toBe("GwenConfigError");
  });

  it("exposes field, value, and hint properties", () => {
    const err = new GwenConfigError("maxEntities", -1, { hint: "Must be positive" });
    expect(err.field).toBe("maxEntities");
    expect(err.value).toBe(-1);
    expect(err.code).toBe("CORE:INVALID_CONFIG");
    expect(err.hint).toBe(__GWEN_DEV__ ? "Must be positive" : undefined);
  });

  it("formats message with field, value, and hint", () => {
    const err = new GwenConfigError("maxEntities", -1, { hint: "Must be positive" });
    expect(err.message).toContain('Invalid config "maxEntities": -1.');
    if (__GWEN_DEV__) expect(err.message).toContain("Must be positive");
  });
});

describe("validateEngineConfig — maxEntities", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("invalid values — must throw", () => {
    it("throws on maxEntities: 0", () => {
      expect(() => validateEngineConfig({ maxEntities: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ maxEntities: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe("maxEntities");
      }
    });

    it("throws on maxEntities: -1", () => {
      expect(() => validateEngineConfig({ maxEntities: -1 })).toThrow(GwenConfigError);
    });

    it("throws on maxEntities: 1.5 (not integer)", () => {
      expect(() => validateEngineConfig({ maxEntities: 1.5 })).toThrow(GwenConfigError);
    });

    it("throws on maxEntities: NaN", () => {
      expect(() => validateEngineConfig({ maxEntities: NaN })).toThrow(GwenConfigError);
    });

    it("throws on maxEntities: 2_000_001 (exceeds upper bound)", () => {
      expect(() => validateEngineConfig({ maxEntities: 2_000_001 })).toThrow(GwenConfigError);
    });
  });

  describe("unusual values — must warn only", () => {
    it("warns on maxEntities: 600_000 but does not throw", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => validateEngineConfig({ maxEntities: 600_000 })).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("valid values — must not throw", () => {
    it("accepts maxEntities: 1 (minimum valid)", () => {
      expect(() => validateEngineConfig({ maxEntities: 1 })).not.toThrow();
    });

    it("accepts maxEntities: 2_000_000 (maximum valid)", () => {
      expect(() => validateEngineConfig({ maxEntities: 2_000_000 })).not.toThrow();
    });

    it("accepts maxEntities: 10_000 (typical)", () => {
      expect(() => validateEngineConfig({ maxEntities: 10_000 })).not.toThrow();
    });
  });
});

describe("validateEngineConfig — targetFPS", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("invalid values — must throw", () => {
    it("throws on targetFPS: 0", () => {
      expect(() => validateEngineConfig({ targetFPS: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ targetFPS: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe("targetFPS");
      }
    });

    it("throws on targetFPS: 301 (exceeds upper bound)", () => {
      expect(() => validateEngineConfig({ targetFPS: 301 })).toThrow(GwenConfigError);
    });

    it("throws on targetFPS: Infinity", () => {
      expect(() => validateEngineConfig({ targetFPS: Infinity })).toThrow(GwenConfigError);
    });
  });

  describe("unusual values — must warn only", () => {
    it("warns on targetFPS: 200 but does not throw", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => validateEngineConfig({ targetFPS: 200 })).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("valid values — must not throw", () => {
    it("accepts targetFPS: 1 (minimum)", () => {
      expect(() => validateEngineConfig({ targetFPS: 1 })).not.toThrow();
    });

    it("accepts targetFPS: 300 (maximum)", () => {
      expect(() => validateEngineConfig({ targetFPS: 300 })).not.toThrow();
    });

    it("accepts targetFPS: 60 (typical)", () => {
      expect(() => validateEngineConfig({ targetFPS: 60 })).not.toThrow();
    });
  });
});

describe("validateEngineConfig — maxDeltaSeconds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("invalid values — must throw", () => {
    it("throws on maxDeltaSeconds: 0 (must be > 0)", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 0 })).toThrow(GwenConfigError);
      try {
        validateEngineConfig({ maxDeltaSeconds: 0 });
      } catch (err) {
        const e = err as GwenConfigError;
        expect(e.field).toBe("maxDeltaSeconds");
      }
    });

    it("throws on maxDeltaSeconds: -1", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: -1 })).toThrow(GwenConfigError);
    });

    it("throws on maxDeltaSeconds: 11 (exceeds upper bound)", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 11 })).toThrow(GwenConfigError);
    });

    it("throws on maxDeltaSeconds: Infinity", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: Infinity })).toThrow(GwenConfigError);
    });

    it("throws on maxDeltaSeconds: NaN", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: NaN })).toThrow(GwenConfigError);
    });
  });

  describe("valid values — must not throw", () => {
    it("accepts maxDeltaSeconds: 0.01 (minimum practical)", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 0.01 })).not.toThrow();
    });

    it("accepts maxDeltaSeconds: 10 (maximum)", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 10 })).not.toThrow();
    });

    it("accepts maxDeltaSeconds: 0.1 (default)", () => {
      expect(() => validateEngineConfig({ maxDeltaSeconds: 0.1 })).not.toThrow();
    });
  });
});

describe("validateEngineConfig — all fields optional", () => {
  it("accepts empty config object", () => {
    expect(() => validateEngineConfig({})).not.toThrow();
  });

  it("accepts partial config", () => {
    expect(() => validateEngineConfig({ maxEntities: 1000 })).not.toThrow();
  });

  it("accepts mixed valid fields", () => {
    expect(() =>
      validateEngineConfig({
        maxEntities: 10_000,
        targetFPS: 60,
        maxDeltaSeconds: 0.1,
      }),
    ).not.toThrow();
  });
});

describe("validateEngineConfig — multiple field validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws on first invalid field encountered", () => {
    expect(() =>
      validateEngineConfig({
        maxEntities: -1,
        targetFPS: 0,
      }),
    ).toThrow(GwenConfigError);
  });

  it("does not warn when field is invalid (only throws)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => validateEngineConfig({ maxEntities: -1 })).toThrow(GwenConfigError);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("validateEngineConfig — logger.providers shape", () => {
  type EngineOptions = Parameters<typeof validateEngineConfig>[0];

  it("a non-array logger.providers throws CORE:INVALID_CONFIG", () => {
    const providers: { length: number } = { length: 1 };
    const options: EngineOptions | { logger: { providers: { length: number } } } = {
      logger: { providers },
    };
    let error: GwenConfigError | undefined;
    try {
      validateEngineConfig(options as EngineOptions);
    } catch (caught: unknown) {
      if (caught instanceof GwenConfigError) error = caught;
    }
    expect({
      code: error?.code,
      field: error?.field,
      hint: error?.hint,
    }).toEqual({
      code: "CORE:INVALID_CONFIG",
      field: "logger.providers",
      hint: __GWEN_DEV__ ? "Pass objects with a handle(entry) method." : undefined,
    });
  });

  it("a null logger provider throws CORE:INVALID_CONFIG", () => {
    const providers: ReadonlyArray<IGwenLogProvider | null> = [null];
    const options:
      | EngineOptions
      | {
          logger: { providers: ReadonlyArray<IGwenLogProvider | null> };
        } = { logger: { providers } };
    let error: GwenConfigError | undefined;
    try {
      validateEngineConfig(options as EngineOptions);
    } catch (caught: unknown) {
      if (caught instanceof GwenConfigError) error = caught;
    }
    expect({
      code: error?.code,
      field: error?.field,
      hint: error?.hint,
    }).toEqual({
      code: "CORE:INVALID_CONFIG",
      field: "logger.providers",
      hint: __GWEN_DEV__ ? "Pass objects with a handle(entry) method." : undefined,
    });
  });

  it("a provider whose handle is not a function throws CORE:INVALID_CONFIG", () => {
    const providers: ReadonlyArray<IGwenLogProvider | { handle: string }> = [{ handle: "nope" }];
    const options:
      | EngineOptions
      | {
          logger: { providers: ReadonlyArray<IGwenLogProvider | { handle: string }> };
        } = { logger: { providers } };
    let error: GwenConfigError | undefined;
    try {
      validateEngineConfig(options as EngineOptions);
    } catch (caught: unknown) {
      if (caught instanceof GwenConfigError) error = caught;
    }
    expect({
      code: error?.code,
      field: error?.field,
      hint: error?.hint,
    }).toEqual({
      code: "CORE:INVALID_CONFIG",
      field: "logger.providers",
      hint: __GWEN_DEV__ ? "Pass objects with a handle(entry) method." : undefined,
    });
  });
});

describe("validateEngineConfig — schema contract", () => {
  function asOptions(
    input: Readonly<Record<string, unknown>>,
  ): Parameters<typeof validateEngineConfig>[0] {
    return input as Parameters<typeof validateEngineConfig>[0];
  }

  it("validateEngineConfig throws CORE:INVALID_CONFIG exactly when checkEngineConfig reports an issue", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const rows: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      {},
      { maxEntities: 1 },
      { maxEntities: 2_000_000 },
      { maxEntities: 2_000_001 },
      { maxEntities: 0 },
      { maxEntities: 1.5 },
      { targetFPS: 1 },
      { targetFPS: 300 },
      { targetFPS: 301 },
      { targetFPS: 0 },
      { maxDeltaSeconds: 10 },
      { maxDeltaSeconds: 10.0001 },
      { maxDeltaSeconds: 0 },
      { maxDeltaSeconds: -0 },
      { variant: "light" },
      { variant: "physics2d" },
      { variant: "physics3d" },
      { variant: "nope" },
      { loop: "internal" },
      { loop: "external" },
      { loop: "fixed" },
      { physicsHz: 0 },
      { physicsHz: -1 },
      { physicsHz: Number.NaN },
      { maxCatchupSteps: 0 },
      { maxCatchupSteps: -1 },
      { maxCatchupSteps: 1.5 },
      { debug: false },
      { debug: true },
      { debug: "yes" },
      { maxEntities: 0, targetFPS: 0, debug: "yes" },
      {
        maxEntities: 1,
        jsUrl: "x",
        wasmUrl: "y",
        glue: {},
        wasmInstance: "isolated",
        queryCacheSize: 4,
        _bridge: {},
      },
      Object.create({ maxEntities: 0 }),
      Object.create({ maxEntities: 1 }),
    ];
    for (const input of rows) {
      const issues = schema.checkEngineConfig(input);
      let caught: unknown;
      try {
        validateEngineConfig(asOptions(input));
      } catch (error: unknown) {
        caught = error;
      }
      if (issues.length === 0) {
        expect(caught).toBeUndefined();
        continue;
      }
      expect(caught).toBeInstanceOf(GwenConfigError);
      if (!(caught instanceof GwenConfigError)) continue;
      expect(caught.code).toBe("CORE:INVALID_CONFIG");
      expect(caught.field).toBe(issues[0]?.path);
    }
  });

  it("boundaries min, min-1, max, max+1 for the 3 numeric fields", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const rows: ReadonlyArray<{
      input: Readonly<Record<string, unknown>>;
      ok: boolean;
      field?: string;
      value?: number;
      hint?: string;
    }> = [
      { input: { maxEntities: 1 }, ok: true },
      {
        input: { maxEntities: 0 },
        ok: false,
        field: "maxEntities",
        value: 0,
        hint: "Must be a positive integer. Try 10_000 for a typical game.",
      },
      { input: { maxEntities: 2_000_000 }, ok: true },
      {
        input: { maxEntities: 2_000_001 },
        ok: false,
        field: "maxEntities",
        value: 2_000_001,
        hint: "Above 2 000 000 entities, consider chunking your world.",
      },
      { input: { targetFPS: 1 }, ok: true },
      {
        input: { targetFPS: 0 },
        ok: false,
        field: "targetFPS",
        value: 0,
        hint: "Must be between 1 and 300. Common values: 30, 60, 120.",
      },
      { input: { targetFPS: 300 }, ok: true },
      {
        input: { targetFPS: 301 },
        ok: false,
        field: "targetFPS",
        value: 301,
        hint: "Must be between 1 and 300. Common values: 30, 60, 120.",
      },
      { input: { maxDeltaSeconds: Number.MIN_VALUE }, ok: true },
      {
        input: { maxDeltaSeconds: 0 },
        ok: false,
        field: "maxDeltaSeconds",
        value: 0,
        hint: "Must be > 0 and ≤ 10. Default 0.1 s prevents spiral-of-death.",
      },
      { input: { maxDeltaSeconds: 10 }, ok: true },
      {
        input: { maxDeltaSeconds: 10.0001 },
        ok: false,
        field: "maxDeltaSeconds",
        value: 10.0001,
        hint: "Must be > 0 and ≤ 10. Default 0.1 s prevents spiral-of-death.",
      },
    ];
    for (const row of rows) {
      let caught: unknown;
      try {
        validateEngineConfig(asOptions(row.input));
      } catch (error: unknown) {
        caught = error;
      }
      if (row.ok) {
        expect(caught).toBeUndefined();
        continue;
      }
      expect(caught).toBeInstanceOf(GwenConfigError);
      if (!(caught instanceof GwenConfigError)) continue;
      expect(caught.code).toBe("CORE:INVALID_CONFIG");
      expect(caught.field).toBe(row.field);
      expect(caught.value).toBe(row.value);
      expect(caught.hint).toBe(__GWEN_DEV__ ? row.hint : undefined);
    }
  });

  it("validateEngineConfig hints Expected <expected>. for variant, loop, physicsHz, maxCatchupSteps and debug", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const rows: ReadonlyArray<Readonly<Record<string, unknown>>> = [
      { variant: "nope" },
      { loop: "fixed" },
      { physicsHz: -1 },
      { maxCatchupSteps: -1 },
      { debug: "yes" },
    ];
    for (const input of rows) {
      const issue = schema.checkEngineConfig(input)[0];
      expect(issue).toBeDefined();
      let caught: unknown;
      try {
        validateEngineConfig(asOptions(input));
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenConfigError);
      if (!(caught instanceof GwenConfigError) || issue === undefined) continue;
      expect(caught.field).toBe(issue.path);
      expect(caught.hint).toBe(__GWEN_DEV__ ? `Expected ${issue.expected}.` : undefined);
    }
  });

  it("validateEngineConfig rejects a null-prototype debug object as CORE:INVALID_CONFIG", () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    const debug: object = Object.create(null);
    let caught: unknown;
    try {
      validateEngineConfig(asOptions({ debug }));
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GwenConfigError);
    if (!(caught instanceof GwenConfigError)) return;
    expect(caught.code).toBe("CORE:INVALID_CONFIG");
    expect(caught.field).toBe("debug");
  });
});

describe("createEngine config defaults", () => {
  it("createEngine without options reads every default from schema ENGINE_DEFAULTS", async () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    expect(typeof schema.ENGINE_DEFAULTS).toBe("object");
    let engine: GwenEngine | undefined;
    try {
      engine = await createEngine();
      expect(schema.ENGINE_DEFAULTS.maxEntities).toBe(10_000);
      expect(engine.maxEntities).toBe(schema.ENGINE_DEFAULTS.maxEntities);
      expect(engine.targetFPS).toBe(schema.ENGINE_DEFAULTS.targetFPS);
      expect(engine.maxDeltaSeconds).toBe(schema.ENGINE_DEFAULTS.maxDeltaSeconds);
      expect(engine.debug).toBe(schema.ENGINE_DEFAULTS.debug);
      expect(engine.variant).toBe("light");
    } finally {
      await engine?.stop();
    }
  });

  it("two engines keep their own config", async () => {
    expect(typeof schema.checkEngineConfig).toBe("function");
    let first: GwenEngine | undefined;
    let second: GwenEngine | undefined;
    try {
      first = await createEngine({ maxEntities: 11, targetFPS: 30 });
      second = await createEngine({ maxEntities: 22, targetFPS: 48 });
      expect(first.maxEntities).toBe(11);
      expect(first.targetFPS).toBe(30);
      expect(second.maxEntities).toBe(22);
      expect(second.targetFPS).toBe(48);
    } finally {
      await second?.stop();
      await first?.stop();
    }
  });
});
