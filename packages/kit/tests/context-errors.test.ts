/**
 * @file Scope slot and context errors live on `@gwenjs/kit` (P-76-5).
 */

import { describe, expect, it } from "vitest";
import type { IGwenScope } from "@gwenjs/schema";
import * as kit from "@gwenjs/kit";
import * as schema from "@gwenjs/schema";

function foreignScope(): IGwenScope {
  return {
    meta: { type: "plugin", id: "foreign" },
    engine: null,
    parent: null,
    paused: false,
    hookCount: 0,
    childCount: 0,
    cleanupCount: 0,
    hook() {
      return () => {};
    },
    onCleanup() {},
    run<T>(fn: () => T): T {
      return fn();
    },
    pause() {},
    resume() {},
    dispose() {},
  };
}

describe("kit context errors", () => {
  it("kit exports GwenContextError, a GwenError with CORE:OUTSIDE_ENGINE_CONTEXT by default", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const error = new kit.GwenContextError("m");
    expect(error).toBeInstanceOf(schema.GwenError);
    expect(error.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    expect(error.name).toBe("GwenContextError");
    expect(error.message).toBe("m");
  });

  it("ACTOR_SETUP_ONLY is kept as the second code", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const error = new kit.GwenContextError("m", "ACTOR_SETUP_ONLY");
    expect(error.code).toBe("ACTOR_SETUP_ONLY");
  });

  it("GwenContextErrorCodes holds the unchanged code strings", () => {
    expect(typeof kit.GwenContextErrorCodes).toBe("object");
    expect(kit.GwenContextErrorCodes).toEqual({
      OUTSIDE_ENGINE_CONTEXT: "CORE:OUTSIDE_ENGINE_CONTEXT",
      ACTOR_SETUP_ONLY: "ACTOR_SETUP_ONLY",
    });
  });

  it("GwenComposableError keeps its code, message and name", () => {
    expect(typeof kit.GwenComposableError).toBe("function");
    const error = new kit.GwenComposableError("COMPOSABLE:X", "m");
    expect(error.code).toBe("COMPOSABLE:X");
    expect(error.message).toBe("m");
    expect(error.name).toBe("GwenComposableError");
  });

  it("getCurrentScope is null until a scope is set, and returns the set scope", () => {
    expect(typeof kit.getCurrentScope).toBe("function");
    expect(typeof kit._setCurrentScope).toBe("function");
    const scope = foreignScope();
    expect(kit.getCurrentScope()).toBeNull();
    kit._setCurrentScope(scope);
    try {
      expect(kit.getCurrentScope()).toBe(scope);
    } finally {
      kit._setCurrentScope(null);
    }
  });
});
