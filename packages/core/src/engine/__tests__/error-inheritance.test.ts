/**
 * @gwenjs/core — error class inheritance tests.
 *
 * Verifies that all built-in GWEN error classes extend GwenError, enabling
 * cross-package instanceof checks without importing from @gwenjs/core.
 */

import { describe, it, expect } from "vitest";
import { GwenError } from "@gwenjs/schema";
import {
  GwenPluginNotFoundError,
  GwenActorError,
  GwenComposableError,
} from "../../engine/engine-errors.js";
import { GwenConfigError } from "../../engine/config-error.js";

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
    const e = new GwenActorError("ACTOR:PLUGIN_NOT_READY", "actor plugin not ready");
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("ACTOR:PLUGIN_NOT_READY");
  });

  it("GwenComposableError extends GwenError", () => {
    const e = new GwenComposableError("COMPOSABLE:OUTSIDE_ACTOR_CONTEXT", "called outside actor");
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("COMPOSABLE:OUTSIDE_ACTOR_CONTEXT");
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
      new GwenComposableError("C", "c"),
      new GwenConfigError("field", 0, "hint"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(GwenError);
    }
  });
});
