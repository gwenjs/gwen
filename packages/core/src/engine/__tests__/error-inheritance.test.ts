/**
 * @gwenjs/core — error class inheritance tests.
 *
 * Verifies that all built-in GWEN error classes extend GwenError, enabling
 * cross-package instanceof checks without importing from @gwenjs/core.
 */

import { describe, it, expect } from "vitest";
import { GwenError } from "@gwenjs/schema";
import * as core from "@gwenjs/core";
import * as kit from "@gwenjs/kit";
import { GwenPluginNotFoundError, GwenActorError } from "../../engine/engine-errors.js";
import { GwenConfigError } from "../../engine/config-error.js";
import { PoolExhaustedError } from "../../actor/runtime/pool/errors.js";

describe("Error class inheritance — all extend GwenError", () => {
  it("GwenPluginNotFoundError extends GwenError", () => {
    const e = new GwenPluginNotFoundError({
      pluginName: "physics2d",
      hint: "Add @gwenjs/physics2d.",
    });
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("CORE:PLUGIN_NOT_FOUND");
    expect(e.docsUrl).toBe("https://gwenjs.github.io/gwen/api/errors#core-plugin-not-found");
    expect(e.hint).toBe(__GWEN_DEV__ ? "Add @gwenjs/physics2d." : undefined);
  });

  it("GwenActorError extends GwenError", () => {
    const e = new GwenActorError("CORE:ACTOR_PLUGIN_NOT_READY", "actor plugin not ready");
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("CORE:ACTOR_PLUGIN_NOT_READY");
  });

  it("PoolExhaustedError is a GwenActorError and a GwenError", () => {
    const error = new PoolExhaustedError("Enemy", 2);
    expect(error).toBeInstanceOf(GwenActorError);
    expect(error).toBeInstanceOf(GwenError);
    expect(error.code).toBe("CORE:ACTOR_POOL_EXHAUSTED");
    expect(error.composable).toBe("pool.acquire");
  });

  it("ComposableErrorCodes and GwenComposableError are gone from @gwenjs/core", () => {
    expect("GwenComposableError" in core).toBe(false);
    expect("ComposableErrorCodes" in core).toBe(false);
    expect("GwenComposableError" in kit).toBe(false);
  });

  it("GwenConfigError extends GwenError", () => {
    const e = new GwenConfigError("maxEntities", -1, {
      hint: "Must be between 100 and 1 000 000.",
    });
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("CORE:INVALID_CONFIG");
    expect(e.composable).toBe("createEngine");
    expect(e.message).toContain('Invalid config "maxEntities": -1.');
  });

  it("a single instanceof GwenError catches all four", () => {
    const errors: unknown[] = [
      new GwenPluginNotFoundError({
        pluginName: "p",
        hint: "h",
      }),
      new GwenActorError("A", "a"),
      new PoolExhaustedError("Enemy", 1),
      new GwenConfigError("field", 0, { hint: "hint" }),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(GwenError);
    }
  });

  it("the new codes have CORE: values", () => {
    const table: unknown = Reflect.get(core, "CoreErrorCodes");
    expect(typeof table).toBe("object");
    if (typeof table !== "object" || table === null) return;
    expect(Reflect.get(table, "WASM_GLUE_MISMATCH")).toBe("CORE:WASM_GLUE_MISMATCH");
    expect(Reflect.get(table, "ENGINE_DISPOSED")).toBe("CORE:ENGINE_DISPOSED");
    expect(Reflect.get(table, "WASM_CAPACITY_EXHAUSTED")).toBe("CORE:WASM_CAPACITY_EXHAUSTED");
    expect(Reflect.get(table, "INVALID_CONFIG")).toBe("CORE:INVALID_CONFIG");
    expect(Reflect.get(table, "PLUGIN_NOT_FOUND")).toBe("CORE:PLUGIN_NOT_FOUND");
    expect(Reflect.get(table, "TWEEN_POOL_EXHAUSTED")).toBe("CORE:TWEEN_POOL_EXHAUSTED");
  });

  it("GwenPluginNotFoundError derives docsUrl and lets what override the default", () => {
    const err = new GwenPluginNotFoundError({
      pluginName: "physics2d",
      what: 'No plugin provides service "physics2d".',
    });
    expect(err.code).toBe("CORE:PLUGIN_NOT_FOUND");
    expect(err.docsUrl).toBe("https://gwenjs.github.io/gwen/api/errors#core-plugin-not-found");
    expect(err.message).toContain('No plugin provides service "physics2d".');
    expect(err.message).not.toContain("is not installed");
    if (__GWEN_DEV__) {
      expect(err.hint).toBe('Add the "physics2d" plugin via engine.use() or in gwen.config.ts.');
    } else {
      expect(err.hint).toBeUndefined();
      expect(err.message).not.toContain("Fix:");
    }
  });
});
