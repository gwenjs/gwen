/**
 * @file Scope slot and context errors live on `@gwenjs/kit` (P-76-5).
 */

import { describe, expect, it } from "vitest";
import type { GwenEngineBase, IGwenLogger, IGwenScope } from "@gwenjs/schema";
import * as kit from "@gwenjs/kit";
import * as schema from "@gwenjs/schema";

function plainEngine(): GwenEngineBase {
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
    inject(): unknown {
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

function foreignScope(): IGwenScope {
  return {
    meta: { type: "plugin", id: "foreign" },
    engine: plainEngine(),
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

const CAPTURE_HINT = [
  "Capture the handle synchronously in the factory, then use it as a closure after await.",
  "const transform = useTransform(); onStart(async () => { await loadAssets(); transform.setPosition(400, 300) })",
].join("\n");

const BOUNDARIES = {
  "CORE:OUTSIDE_ENGINE_CONTEXT": [
    "defineSystem()",
    "defineActor()",
    "defineScene()",
    "plugin setup()",
    "engine.run()",
  ],
  "CORE:OUTSIDE_ACTOR_CONTEXT": ["defineActor()"],
  "CORE:OUTSIDE_SYSTEM_CONTEXT": ["defineSystem()", "defineActor()"],
  "CORE:OUTSIDE_SCENE_CONTEXT": ["defineScene()"],
  "CORE:OUTSIDE_LAYOUT_CONTEXT": ["defineLayout()"],
  "CORE:OUTSIDE_CLEANUP_CONTEXT": ["defineActor()", "plugin setup()", "withCleanup()"],
};

describe("kit context errors", () => {
  it("GwenContextError names the composable and the valid contexts", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const error = new kit.GwenContextError(
      kit.GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "useDynamicBody",
    );
    expect(error).toBeInstanceOf(schema.GwenError);
    expect(error.composable).toBe("useDynamicBody");
    expect(error.validContexts).toEqual(["defineActor()"]);
    const lines = error.message.split("\n");
    expect(lines[0]).toBe("[useDynamicBody()] Called outside defineActor().");
    expect(lines[lines.length - 1]).toBe(
      "See https://gwenjs.github.io/gwen/api/errors#core-outside-actor-context (CORE:OUTSIDE_ACTOR_CONTEXT)",
    );
  });

  it("every context code lists its valid contexts", () => {
    expect(typeof kit.GWEN_CONTEXT_BOUNDARIES).toBe("object");
    expect(kit.GWEN_CONTEXT_BOUNDARIES).toEqual(BOUNDARIES);
  });

  it("GwenContextErrorCodes holds the six CORE:OUTSIDE codes", () => {
    expect(typeof kit.GwenContextErrorCodes).toBe("object");
    expect(kit.GwenContextErrorCodes).toEqual({
      OUTSIDE_ENGINE_CONTEXT: "CORE:OUTSIDE_ENGINE_CONTEXT",
      OUTSIDE_ACTOR_CONTEXT: "CORE:OUTSIDE_ACTOR_CONTEXT",
      OUTSIDE_SYSTEM_CONTEXT: "CORE:OUTSIDE_SYSTEM_CONTEXT",
      OUTSIDE_SCENE_CONTEXT: "CORE:OUTSIDE_SCENE_CONTEXT",
      OUTSIDE_LAYOUT_CONTEXT: "CORE:OUTSIDE_LAYOUT_CONTEXT",
      OUTSIDE_CLEANUP_CONTEXT: "CORE:OUTSIDE_CLEANUP_CONTEXT",
    });
  });

  it("the dev hint is the capture pattern, the engine code gets the three steps", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const engine = new kit.GwenContextError(
      kit.GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT,
      "useEngine",
    );
    const others = [
      kit.GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      kit.GwenContextErrorCodes.OUTSIDE_SYSTEM_CONTEXT,
      kit.GwenContextErrorCodes.OUTSIDE_SCENE_CONTEXT,
      kit.GwenContextErrorCodes.OUTSIDE_LAYOUT_CONTEXT,
      kit.GwenContextErrorCodes.OUTSIDE_CLEANUP_CONTEXT,
    ];
    if (__GWEN_DEV__) {
      const hint = engine.hint ?? "";
      expect(hint).toMatch(
        /Wrap with engine\.run\(\)[\s\S]*`gwen dev` \/ `gwen build` \(the GWEN Vite plugin restores the context\)[\s\S]*use withAsyncContext\(\) \(exported by the core package\)[\s\S]*capture the composable before the first await/,
      );
      expect(hint.includes("import {") || hint.includes("@gwenjs/core")).toBe(false);
      for (const code of others) {
        const error = new kit.GwenContextError(code, "useDynamicBody");
        expect(error.hint).toBe(CAPTURE_HINT);
      }
    } else {
      expect(engine.message.includes("Fix:")).toBe(false);
      expect(engine.hint).toBeUndefined();
      expect(engine.message.split("\n")[0]).toBe(
        "[useEngine()] Called outside defineSystem() or defineActor() or defineScene() or plugin setup() or engine.run().",
      );
      for (const code of others) {
        const error = new kit.GwenContextError(code, "useDynamicBody");
        expect(error.message.includes("Fix:")).toBe(false);
      }
    }
  });

  it("cause is kept", () => {
    expect(typeof kit.GwenContextError).toBe("function");
    const cause = new Error("root");
    const error = new kit.GwenContextError(
      kit.GwenContextErrorCodes.OUTSIDE_ACTOR_CONTEXT,
      "useDynamicBody",
      { cause },
    );
    expect(error.cause).toBe(cause);
  });

  it("GwenComposableError is not exported", () => {
    expect("GwenComposableError" in kit).toBe(false);
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
