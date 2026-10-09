/**
 * Tests for plugin error isolation (RFC-011 Phase 2)
 */
import { describe, it, expect, vi } from "vitest";
import { createEngine } from "../src/index";
import type { GwenPlugin, EngineErrorBus } from "../src/index";
import type { GwenLogger } from "@gwenjs/schema";
import { CoreErrorCodes } from "../src/index";
import { createMockWasmEngine } from "./helpers/mock-wasm-engine";

// ─── Minimal mock error bus ───────────────────────────────────────────────────

function createMockErrorBus(): EngineErrorBus & {
  emitted: Array<Parameters<EngineErrorBus["emit"]>[0]>;
} {
  const emitted: Array<Parameters<EngineErrorBus["emit"]>[0]> = [];
  return {
    emitted,
    emit(event) {
      emitted.push(event);
    },
    on() {
      return () => {};
    },
    onFatal() {
      return () => {};
    },
  };
}

describe("plugin error isolation", () => {
  describe("plugin setup error", () => {
    it("emits PLUGIN_SETUP_ERROR to error bus when setup throws", async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: "bad-setup-plugin",
        setup() {
          throw new Error("setup exploded");
        },
      };
      const engine = await createEngine({ errorBus: bus });

      await expect(engine.use(plugin)).rejects.toThrow("setup exploded");

      const setupErrors = bus.emitted.filter((e) => e.code === CoreErrorCodes.PLUGIN_SETUP_ERROR);
      expect(setupErrors).toHaveLength(1);
    });

    it("re-throws after emitting — setup failure is an error, not fatal", async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: "fatal-setup-plugin",
        setup() {
          throw new Error("fatal setup");
        },
      };
      const engine = await createEngine({ errorBus: bus });

      await expect(engine.use(plugin)).rejects.toThrow("fatal setup");

      const setupErrors = bus.emitted.filter((e) => e.code === CoreErrorCodes.PLUGIN_SETUP_ERROR);
      expect(setupErrors).toHaveLength(1);
      expect(setupErrors[0]!.level).toBe("error");
      expect(engine.state).not.toBe("faulted");
    });

    it("includes plugin name in the error message", async () => {
      const bus = createMockErrorBus();
      const plugin: GwenPlugin = {
        name: "named-setup-plugin",
        setup() {
          throw new Error("specific failure");
        },
      };
      const engine = await createEngine({ errorBus: bus });

      await expect(engine.use(plugin)).rejects.toBeDefined();

      const setupErrors = bus.emitted.filter((e) => e.code === CoreErrorCodes.PLUGIN_SETUP_ERROR);
      expect(setupErrors[0]!.message).toContain("named-setup-plugin");
      expect(setupErrors[0]!.message).toContain("specific failure");
    });
  });

  describe("WASM error codes", () => {
    it("keeps a community WASM trap at error level and does not poison the core bridge", async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });
      const bridge = engine.tryInject("wasm:bridge");
      if (bridge === undefined) {
        throw new Error("wasm bridge missing");
      }
      bridge._injectMock(createMockWasmEngine());
      const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      await engine.loadWasmModule({
        name: "community-mod",
        url: `data:application/wasm;base64,${Buffer.from(wasmBytes).toString("base64")}`,
        versionPolicy: "ignore",
        step() {
          throw new WebAssembly.RuntimeError("unreachable");
        },
      });

      await engine.advance(0.016);

      const events = bus.emitted.filter((event) => event.source === "wasm:community-mod");
      expect(events).toHaveLength(1);
      expect(events[0]!.level).toBe("error");
      expect(events[0]!.code).toBe(CoreErrorCodes.WASM_PANIC);
      expect(bus.emitted.filter((event) => event.level === "fatal")).toHaveLength(0);
      expect(bridge.createEntity()).toEqual({ index: 0, generation: 0 });
    });

    it('emits with source "wasm:<name>" for community WASM module errors', async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });
      const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      await engine.loadWasmModule({
        name: "my-audio-mod",
        url: `data:application/wasm;base64,${Buffer.from(wasmBytes).toString("base64")}`,
        versionPolicy: "ignore",
        step() {
          throw new TypeError("audio step failed");
        },
      });

      try {
        await engine.advance(0.016);

        const wasmErrors = bus.emitted.filter((e) => e.source === "wasm:my-audio-mod");
        expect(wasmErrors).toHaveLength(1);
        expect(wasmErrors[0]!.code).toBe(CoreErrorCodes.FRAME_LOOP_ERROR);
        expect(wasmErrors[0]!.message).toContain("audio step failed");
      } finally {
        await engine.stop();
      }
    });
  });

  describe("logger injectable", () => {
    it('engine.inject("logger") returns the engine logger', async () => {
      const engine = await createEngine();
      const logger = engine.inject("logger");
      expect(logger).toBeDefined();
      expect(typeof logger.warn).toBe("function");
      expect(logger).toBe(engine.logger);
    });

    it("child logger from inject has correct source", async () => {
      const engine = await createEngine({ debug: true });
      const logger = engine.inject("logger");
      const sink = vi.fn();
      (logger as GwenLogger).setSink(sink);

      const child = logger.child("@gwenjs/test");
      child.warn("test");

      expect(sink).toHaveBeenCalledOnce();
      expect(sink.mock.calls[0]![0].source).toBe("@gwenjs/test");
    });
  });

  describe("multiple plugins — isolation", () => {
    it("both plugins can register hooks in the same engine phase", async () => {
      const engine = await createEngine();

      const calls: string[] = [];
      await engine.use({
        name: "first",
        setup(e) {
          e.hooks.hook("engine:update", () => {
            calls.push("first");
          });
        },
      });
      await engine.use({
        name: "second",
        setup(e) {
          e.hooks.hook("engine:update", () => {
            calls.push("second");
          });
        },
      });

      await engine.advance(0.016);
      // Both hooks should have been registered and called
      expect(calls).toContain("first");
      expect(calls).toContain("second");
    });
  });
});
