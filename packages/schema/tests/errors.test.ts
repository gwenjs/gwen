/**
 * @gwenjs/schema — GwenError base class tests.
 *
 * GwenError is a runtime class (not just an interface), so these are full
 * unit tests covering construction, inheritance, and cross-package instanceof.
 */

import { describe, it, expect } from "vitest";
import { GwenError } from "../src/errors";
import type { GwenErrorLevel, GwenErrorPayload, GwenErrorBusBase } from "../src/errors";

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
    const e = new GwenError("GWEN_PLUGIN_NOT_FOUND", "plugin not found");
    expect(e.code).toBe("GWEN_PLUGIN_NOT_FOUND");
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
      onFatal(cb) {
        fatalCb = cb;
      },
    };

    bus.emit({ level: "error", code: "TEST", message: "hi" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].code).toBe("TEST");

    let called = false;
    bus.onFatal(() => {
      called = true;
    });
    fatalCb!();
    expect(called).toBe(true);
  });
});
