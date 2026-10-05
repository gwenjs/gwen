/**
 * Tests for plugin error isolation (RFC-011 Phase 2)
 */
import { describe, it, expect, vi } from "vitest";
import { createEngine } from "../src/index";
import type { GwenPlugin, EngineErrorBus } from "../src/index";
import { CoreErrorCodes } from "../src/index";

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
    it("emits WASM_PANIC when physics step throws WebAssembly.RuntimeError", async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });

      // Enable physics2d and override the step to throw a WASM RuntimeError
      engine.wasmBridge.physics2d.enable({});
      engine.wasmBridge.physics2d.step = () => {
        throw new WebAssembly.RuntimeError("unreachable executed");
      };

      await engine.advance(0.016);

      const wasmPanics = bus.emitted.filter((e) => e.code === CoreErrorCodes.WASM_PANIC);
      expect(wasmPanics).toHaveLength(1);
      expect(wasmPanics[0]!.source).toBe("gwen_core.wasm");
    });

    it("emits FRAME_LOOP_ERROR when physics step throws a non-WASM error", async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });

      engine.wasmBridge.physics2d.enable({});
      engine.wasmBridge.physics2d.step = () => {
        throw new TypeError("not a wasm error");
      };

      await engine.advance(0.016);

      const frameErrors = bus.emitted.filter(
        (e) => e.code === CoreErrorCodes.FRAME_LOOP_ERROR && e.source === "gwen_core.wasm",
      );
      expect(frameErrors).toHaveLength(1);
      expect(frameErrors[0]!.level).toBe("fatal");
    });

    it('emits with source "wasm:<name>" for community WASM module errors', async () => {
      const bus = createMockErrorBus();
      const engine = await createEngine({ errorBus: bus });

      // Inject a fake entry into the private _wasmModules map to avoid needing a real .wasm file
      const fakeHandle = {
        name: "my-audio-mod",
        exports: {},
        memory: undefined,
        region: () => {
          throw new Error("no regions");
        },
        channel: () => {
          throw new Error("no channels");
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (engine as any)._wasmModules.set("my-audio-mod", {
        handle: fakeHandle,
        step: () => {
          throw new TypeError("audio step failed");
        },
      });

      await engine.advance(0.016);

      const wasmErrors = bus.emitted.filter((e) => e.source === "wasm:my-audio-mod");
      expect(wasmErrors).toHaveLength(1);
      expect(wasmErrors[0]!.code).toBe(CoreErrorCodes.FRAME_LOOP_ERROR);
      expect(wasmErrors[0]!.message).toContain("audio step failed");
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
      logger.setSink(sink);

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
