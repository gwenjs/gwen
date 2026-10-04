import { describe, it, expect, vi } from "vitest";
import {
  createEngine,
  createErrorBus,
  CoreErrorCodes,
  type EngineErrorBus,
  type EngineErrorPayload,
} from "../../index.js";

/**
 * Create a mock error bus for testing.
 */
function makeMockBus(): EngineErrorBus & {
  _emitted: Array<{
    level: string;
    code: string;
    message: string;
    source?: string;
    error?: unknown;
    context?: Record<string, unknown>;
  }>;
  _fatalCb: (() => void) | null;
  _installed: boolean;
} {
  const bus = {
    _emitted: [] as Array<{
      level: string;
      code: string;
      message: string;
      source?: string;
      error?: unknown;
      context?: Record<string, unknown>;
    }>,
    _fatalCb: null as (() => void) | null,
    _installed: false,
    emit(event: {
      level: string;
      code: string;
      message: string;
      source?: string;
      error?: unknown;
      context?: Record<string, unknown>;
    }) {
      this._emitted.push(event);
    },
    on() {},
    onFatal(cb: () => void) {
      this._fatalCb = cb;
    },
    install() {
      this._installed = true;
      return () => {};
    },
  };
  return bus;
}

describe("createErrorBus", () => {
  it("runs on handlers before onFatal when the event is fatal", () => {
    const bus = createErrorBus();
    const order: string[] = [];
    bus.on(() => {
      order.push("on-1");
    });
    bus.on(() => {
      order.push("on-2");
    });
    bus.onFatal(() => {
      order.push("onFatal");
    });

    bus.emit({ level: "fatal", code: "TEST:FATAL", message: "fatal" });
    expect(order).toEqual(["on-1", "on-2", "onFatal"]);

    order.length = 0;
    bus.emit({ level: "error", code: "TEST:ERROR", message: "error" });
    expect(order).toEqual(["on-1", "on-2"]);
  });

  it("returns a no-op uninstall when window is missing", () => {
    const bus = createErrorBus();
    const uninstall = bus.install?.();
    expect(typeof uninstall).toBe("function");
    uninstall?.();
  });

  it("returns the same uninstall and restores window.onerror", () => {
    const listeners = new Map<string, Set<EventListener>>();
    const fake = {
      onerror: null as Window["onerror"],
      addEventListener(type: string, listener: EventListener): void {
        const set = listeners.get(type) ?? new Set<EventListener>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener): void {
        listeners.get(type)?.delete(listener);
      },
    };
    vi.stubGlobal("window", fake);
    try {
      const bus = createErrorBus();
      const uninstall = bus.install?.();
      const again = bus.install?.();
      expect(again).toBe(uninstall);
      expect(typeof fake.onerror).toBe("function");
      expect(listeners.get("unhandledrejection")?.size).toBe(1);
      uninstall?.();
      expect(fake.onerror).toBeNull();
      expect(listeners.get("unhandledrejection")?.size).toBe(0);
      uninstall?.();
      expect(fake.onerror).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("GwenEngine + EngineErrorBus (Task 5)", () => {
  describe("Error bus service registration", () => {
    it('registers the error bus as the "errors" service when provided', async () => {
      const bus = makeMockBus();
      const engine = await createEngine({ errorBus: bus });
      expect(engine.inject("errors")).toBe(bus);
      expect(engine.errors).toBe(bus);
    });

    it("provides a default error bus when errorBus is omitted", async () => {
      const engine = await createEngine();
      expect(engine.inject("errors")).toBe(engine.errors);
    });

    it("registers onFatal callback during construction", async () => {
      const bus = makeMockBus();
      await createEngine({ errorBus: bus });
      expect(bus._fatalCb).toBeTypeOf("function");
    });

    it("stop removes window handlers installed by createEngine", async () => {
      const listeners = new Map<string, Set<EventListener>>();
      const fake = {
        onerror: null as Window["onerror"],
        addEventListener(type: string, listener: EventListener): void {
          const set = listeners.get(type) ?? new Set<EventListener>();
          set.add(listener);
          listeners.set(type, set);
        },
        removeEventListener(type: string, listener: EventListener): void {
          listeners.get(type)?.delete(listener);
        },
      };
      vi.stubGlobal("window", fake);
      try {
        const engine = await createEngine();
        expect(typeof fake.onerror).toBe("function");
        await engine.stop();
        expect(fake.onerror).toBeNull();
        expect(listeners.get("unhandledrejection")?.size ?? 0).toBe(0);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe("startExternal() fix (Issue B)", () => {
    it("sets _running = true so subsequent advance() calls work", async () => {
      const engine = await createEngine();
      await engine.startExternal();

      // Should be able to call advance() without error
      await engine.advance(0.016);

      // Should be able to call stop()
      await engine.stop();

      expect(true).toBe(true);
    });

    it("allows multiple frames via advance() after startExternal()", async () => {
      const engine = await createEngine();
      let tickCount = 0;
      engine.hooks.hook("engine:tick", () => {
        tickCount++;
      });

      await engine.startExternal();
      await engine.advance(0.016);
      await engine.advance(0.016);
      await engine.advance(0.016);

      expect(tickCount).toBe(3);
      await engine.stop();
    });

    it("fires engine:init and engine:start hooks during startExternal()", async () => {
      const engine = await createEngine();
      const hooks: string[] = [];

      engine.hooks.hook("engine:init", () => hooks.push("init"));
      engine.hooks.hook("engine:start", () => hooks.push("start"));

      await engine.startExternal();
      expect(hooks).toEqual(["init", "start"]);

      await engine.stop();
    });
  });

  describe("Error bus fatal callback", () => {
    it("registers fatal callback that can stop the engine", async () => {
      const bus = makeMockBus();
      const engine = await createEngine({ errorBus: bus });

      const stopHookCalls: string[] = [];
      engine.hooks.hook("engine:stop", () => stopHookCalls.push("stop"));
      await engine.startExternal();

      // Trigger the fatal callback while the engine is running.
      if (bus._fatalCb) {
        await bus._fatalCb();
      }

      expect(stopHookCalls).toContain("stop");
    });

    it("fatal callback is registered during construction", async () => {
      const bus = makeMockBus();
      const _engine = await createEngine({ errorBus: bus });

      // Fatal callback should be a function
      expect(bus._fatalCb).toBeTypeOf("function");
    });
  });

  describe("CoreErrorCodes constant", () => {
    it("exports all required error codes", () => {
      expect(CoreErrorCodes.FRAME_LOOP_ERROR).toBe("CORE:FRAME_LOOP_ERROR");
      expect(CoreErrorCodes.PLUGIN_SETUP_ERROR).toBe("CORE:PLUGIN_SETUP_ERROR");
      expect(CoreErrorCodes.WASM_LOAD_ERROR).toBe("CORE:WASM_LOAD_ERROR");
    });

    it("exports CoreErrorCodes from createEngine module", async () => {
      // Verify that CoreErrorCodes can be imported and used
      expect(typeof CoreErrorCodes).toBe("object");
      expect(Object.keys(CoreErrorCodes).length).toBeGreaterThan(0);
    });
  });

  describe("EngineErrorPayload type", () => {
    it("payload can be created with required fields", () => {
      const payload: EngineErrorPayload = {
        code: "TEST:ERROR",
        message: "Test error message",
      };
      expect(payload.code).toBe("TEST:ERROR");
      expect(payload.message).toBe("Test error message");
    });

    it("payload can include optional fields", () => {
      const err = new Error("cause");
      const payload: EngineErrorPayload = {
        code: "TEST:ERROR",
        message: "Test error",
        cause: err,
        frame: 5,
      };
      expect(payload.cause).toBe(err);
      expect(payload.frame).toBe(5);
    });
  });

  describe("EngineErrorBus interface compatibility", () => {
    it("mock bus satisfies EngineErrorBus interface", () => {
      const bus = makeMockBus();
      // These should not throw type errors
      expect(typeof bus.emit).toBe("function");
      expect(typeof bus.onFatal).toBe("function");
      expect(typeof bus.install).toBe("function");
    });

    it("emit method accepts correct event structure", () => {
      const bus = makeMockBus();
      bus.emit({
        level: "error",
        code: "TEST:CODE",
        message: "Test message",
        source: "@gwenjs/core",
        error: new Error("test"),
        context: { key: "value" },
      });

      expect(bus._emitted).toHaveLength(1);
      expect(bus._emitted[0]!.level).toBe("error");
      expect(bus._emitted[0]!.code).toBe("TEST:CODE");
    });
  });

  describe("No error bus (graceful degradation)", () => {
    it("engine works normally without error bus", async () => {
      const engine = await createEngine(); // No errorBus

      let tickCount = 0;
      engine.hooks.hook("engine:tick", () => {
        tickCount++;
      });

      await engine.startExternal();
      await engine.advance(0.016);

      expect(tickCount).toBe(1);
      await engine.stop();
    });

    it("engine.errors is the default bus returned by tryInject", async () => {
      const engine = await createEngine();
      const bus = engine.tryInject("errors");
      expect(bus).toBeDefined();
      expect(engine.errors).toBe(bus);
    });
  });
});
