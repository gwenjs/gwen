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
      docsUrl: "https://gwenengine.dev",
    });
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("GWEN_PLUGIN_NOT_FOUND");
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
    const e = new GwenConfigError("maxEntities", -1, "Must be between 100 and 1 000 000.");
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("GWEN_CONFIG_ERROR");
  });

  it("a single instanceof GwenError catches all four", () => {
    const errors: unknown[] = [
      new GwenPluginNotFoundError({
        pluginName: "p",
        hint: "h",
        docsUrl: "https://x",
      }),
      new GwenActorError("A", "a"),
      new PoolExhaustedError("Enemy", 1),
      new GwenConfigError("field", 0, "hint"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(GwenError);
    }
  });
});
