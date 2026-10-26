/**
 * @gwenjs/schema — GwenError base class tests.
 *
 * GwenError is a runtime class (not just an interface), so these are full
 * unit tests covering construction, inheritance, and cross-package instanceof.
 */

import { describe, it, expect } from "vitest";
import { GwenError } from "../src/errors";
import * as schema from "../src/index.js";
import type {
  GwenErrorLevel,
  GwenErrorPayload,
  GwenErrorTarget,
  GwenErrorBusBase,
} from "../src/errors";

// ─── GwenError ────────────────────────────────────────────────────────────────

describe("GwenError", () => {
  it("is an instance of Error", () => {
    const e = new GwenError("TEST_CODE", "test message");
    expect(e).toBeInstanceOf(Error);
  });

  it("is an instance of GwenError", () => {
    const e = new GwenError("TEST_CODE", "test message");
    expect(e).toBeInstanceOf(GwenError);
  });

  it("stores the code", () => {
    const e = new GwenError("CORE:PLUGIN_NOT_FOUND", "plugin not found");
    expect(e.code).toBe("CORE:PLUGIN_NOT_FOUND");
  });

  it("stores the message", () => {
    const e = new GwenError("CODE", "detailed message");
    expect(e.message).toBe("detailed message");
  });

  it("sets name to GwenError", () => {
    const e = new GwenError("CODE", "msg");
    expect(e.name).toBe("GwenError");
  });

  it("code is readonly", () => {
    const e = new GwenError("CODE", "msg");
    // TypeScript readonly — verify it exists and has the right value
    expect(typeof e.code).toBe("string");
  });

  it("subclasses of GwenError are instanceof GwenError", () => {
    class MyError extends GwenError {
      constructor(msg: string) {
        super("MY_ERROR", msg);
        this.name = "MyError";
      }
    }
    const e = new MyError("something went wrong");
    expect(e).toBeInstanceOf(GwenError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("MY_ERROR");
    expect(e.name).toBe("MyError");
  });

  it("subclasses can add extra properties", () => {
    class PluginError extends GwenError {
      constructor(
        public readonly pluginName: string,
        msg: string,
      ) {
        super("PLUGIN_ERROR", msg);
        this.name = "PluginError";
      }
    }
    const e = new PluginError("audio", "audio plugin not found");
    expect(e.pluginName).toBe("audio");
    expect(e).toBeInstanceOf(GwenError);
  });
});

// ─── GwenErrorLevel ───────────────────────────────────────────────────────────

describe("GwenErrorLevel (type)", () => {
  it("accepts all valid levels at runtime", () => {
    const levels: GwenErrorLevel[] = ["fatal", "error", "warning", "info", "verbose"];
    expect(levels).toHaveLength(5);
  });
});

// ─── GwenErrorPayload ─────────────────────────────────────────────────────────

describe("GwenErrorPayload (structural)", () => {
  it("accepts a minimal payload (required fields only)", () => {
    const payload: GwenErrorPayload = {
      level: "error",
      code: "GWEN_TEST",
      message: "something failed",
    };
    expect(payload.code).toBe("GWEN_TEST");
  });

  it("accepts a full payload with all optional fields", () => {
    const originalError = new Error("original");
    const payload: GwenErrorPayload = {
      level: "fatal",
      code: "GWEN_FATAL",
      message: "engine exploded",
      source: "@gwenjs/core",
      error: originalError,
      context: { frame: 42, plugin: "physics2d" },
    };
    expect(payload.source).toBe("@gwenjs/core");
    expect(payload.error).toBe(originalError);
    expect(payload.context?.frame).toBe(42);
  });

  it("accepts an optional GwenErrorTarget", () => {
    const system: GwenErrorTarget = {
      kind: "system",
      id: "system#3",
      name: "Move",
    };
    const actor: GwenErrorTarget = {
      kind: "actor",
      id: "actor#1",
      name: "Bullet",
      entityId: 7n,
    };
    const wasm: GwenErrorTarget = {
      kind: "wasm-module",
      id: "wasm:audio",
      name: "audio",
    };
    const payload: GwenErrorPayload = {
      level: "error",
      code: "CORE:PLUGIN_RUNTIME_ERROR",
      message: "system failed",
      target: system,
    };

    expect(payload.target).toBe(system);
    expect(actor.entityId).toBe(7n);
    expect(wasm.kind).toBe("wasm-module");
    expect(payload.target?.id).toBe("system#3");
  });
});

// ─── GwenErrorBusBase (structural) ───────────────────────────────────────────

describe("GwenErrorBusBase (structural)", () => {
  it("an object implementing the interface satisfies the type", () => {
    const emitted: GwenErrorPayload[] = [];
    let fatalCb: (() => void) | null = null;

    const bus: GwenErrorBusBase = {
      emit(payload) {
        emitted.push(payload);
      },
      on() {
        return () => {};
      },
      onFatal(cb) {
        fatalCb = cb;
        return () => {
          fatalCb = null;
        };
      },
    };

    bus.emit({ level: "error", code: "TEST", message: "hi" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].code).toBe("TEST");

    let called = false;
    const unsubscribe = bus.onFatal(() => {
      called = true;
    });
    expect(typeof unsubscribe).toBe("function");
    fatalCb!();
    expect(called).toBe(true);
    unsubscribe();
    expect(fatalCb).toBeNull();
  });
});

const DOCS = "https://gwenjs.github.io/gwen/api/errors";

describe("GwenError message grammar", () => {
  it("renders [composable()] what, Fix and See lines", () => {
    const error = new schema.GwenError(
      "CORE:OUTSIDE_ACTOR_CONTEXT",
      "Called outside defineActor().",
      {
        composable: "useDynamicBody",
        hint: "Call it inside defineActor().",
      },
    );
    expect(error.message).toBe(
      `[useDynamicBody()] Called outside defineActor().\nFix: Call it inside defineActor().\nSee ${DOCS}#core-outside-actor-context (CORE:OUTSIDE_ACTOR_CONTEXT)`,
    );
  });
  it("where falls back to GWEN when composable is unset", () => {
    const error = new schema.GwenError("SCHEMA:INVALID_CONFIG", "Broken.", {});
    expect(error.message.startsWith("[GWEN] Broken.")).toBe(true);
  });
  it("has no Fix line when hint is undefined", () => {
    const error = new schema.GwenError("C:A", "Broken.", { composable: "x", hint: undefined });
    expect(error.message.includes("\nFix:")).toBe(false);
    expect(error.message.split("\n")).toHaveLength(2);
    expect(error.message.startsWith("[x()] Broken.")).toBe(true);
  });
  it("keeps a multi-line hint verbatim", () => {
    const hint = "Call it inside defineActor().\nKeep the handle.";
    const error = new schema.GwenError("C:A", "Out.", { composable: "useDynamicBody", hint });
    expect(error.message).toContain(`\nFix: ${hint}`);
  });
  it("derives docsUrl from the code", () => {
    expect(typeof schema.errorDocsUrl).toBe("function");
    expect(typeof schema.errorDocsAnchor).toBe("function");
    const error = new schema.GwenError("PHYSICS2D:INVALID_LAYERS", "Bad layers.", {});
    expect(schema.errorDocsAnchor("PHYSICS2D:INVALID_LAYERS")).toBe("physics2d-invalid-layers");
    expect(error.docsUrl).toBe(`${DOCS}#physics2d-invalid-layers`);
    expect(error.docsUrl).toBe(schema.errorDocsUrl(error.code));
  });
  it("a subclass with a static docsBase links to its own site", () => {
    expect(typeof schema.errorDocsUrl).toBe("function");
    class OwnSite extends schema.GwenError {
      static docsBase = "https://x.test";
    }
    const own = new OwnSite("RENDERER_THREE:NOT_MOUNTED", "Not mounted.", {});
    expect(own.docsUrl).toBe("https://x.test/api/errors#renderer-three-not-mounted");
    expect(own.message).toContain("https://x.test/api/errors#renderer-three-not-mounted");
    class FrameworkSite extends schema.GwenError {}
    const plain = new FrameworkSite("RENDERER_THREE:NOT_MOUNTED", "Not mounted.", {});
    expect(plain.docsUrl).toBe(`${schema.GWEN_DOCS_BASE}/api/errors#renderer-three-not-mounted`);
    expect(schema.GWEN_DOCS_BASE).toBe("https://gwenjs.github.io/gwen");
  });
  it("stores composable and hint", () => {
    const named = new schema.GwenError("CORE:A", "One.", { composable: "useA", hint: "Fix A." });
    const plain = new schema.GwenError("CORE:B", "Two.", {});
    expect(named.composable).toBe("useA");
    expect(named.hint).toBe("Fix A.");
    expect(plain.composable).toBeUndefined();
    expect(plain.hint).toBeUndefined();
  });
  it("keeps cause", () => {
    const original = new Error("root");
    const error = new schema.GwenError("CORE:OUTSIDE_ACTOR_CONTEXT", "Wrapped.", {
      cause: original,
    });
    expect(error.cause).toBe(original);
    expect(error.message.startsWith("[GWEN] Wrapped.\nSee ")).toBe(true);
  });
  it("a two-argument GwenError keeps its raw message during the migration", () => {
    const error = new schema.GwenError("CORE:OUTSIDE_ACTOR_CONTEXT", "detailed message");
    expect(error.message).toBe("detailed message");
    expect(typeof schema.errorDocsUrl).toBe("function");
    expect(error.docsUrl).toBe(schema.errorDocsUrl("CORE:OUTSIDE_ACTOR_CONTEXT"));
  });
});
