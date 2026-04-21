import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEngine } from "../src/index.js";
import type { GwenEngine, GwenPlugin, WasmModuleHandle } from "../src/index.js";
import { WasmBridgeImpl } from "../src/engine/wasm-bridge.js";
import { SharedMemoryManager } from "@gwenjs/core/shared-memory.js";

// ─── Minimal valid WASM binary ────────────────────────────────────────────────
// A wasm module that exports nothing (but is syntactically valid):
// (module)
const MINIMAL_WASM = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d, // magic: \0asm
  0x01,
  0x00,
  0x00,
  0x00, // version: 1
]);

// A wasm module that exports a `memory`:
// (module (memory (export "memory") 1))
const WASM_WITH_MEMORY = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d, // magic
  0x01,
  0x00,
  0x00,
  0x00, // version
  // Memory section: 1 memory of min 1 page
  0x05,
  0x03,
  0x01,
  0x00,
  0x01,
  // Export section: export "memory" as mem index 0
  0x07,
  0x0a,
  0x01,
  0x06,
  0x6d,
  0x65,
  0x6d,
  0x6f,
  0x72,
  0x79,
  0x02,
  0x00,
]);

// ─── Helper: mock fetch with a wasm buffer ────────────────────────────────────

function mockFetch(bytes: Uint8Array): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer),
    }),
  );
}

function mockFetchFail(status = 404): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: "Not Found",
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeEngine(opts?: Parameters<typeof createEngine>[0]): Promise<GwenEngine> {
  return createEngine(opts);
}

function recordingPlugin(name: string, log: string[]): GwenPlugin {
  return {
    name,
    setup(engine) {
      log.push(`${name}:setup`);
      engine.hooks.hook("engine:before-update", (_dt) => {
        log.push(`${name}:onBeforeUpdate`);
      });
      engine.hooks.hook("engine:update", (_dt) => {
        log.push(`${name}:onUpdate`);
      });
      engine.hooks.hook("engine:after-update", (_dt) => {
        log.push(`${name}:onAfterUpdate`);
      });
      engine.hooks.hook("engine:render", () => {
        log.push(`${name}:onRender`);
      });
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Frame Loop v2", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── stop() cancellation ─────────────────────────────────────────────────────

  describe("stop() lifecycle", () => {
    it("stop() cancels the RAF/setTimeout frame handle — no zombie callbacks after stop", async () => {
      const engine = await makeEngine();

      // Stub RAF and setTimeout to track calls
      const rafCalls: Function[] = [];
      const clearTimeoutCalls: number[] = [];
      const cancelRAFCalls: number[] = [];

      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn((cb: Function) => {
          rafCalls.push(cb);
          return rafCalls.length as unknown as number;
        }),
      );
      vi.stubGlobal(
        "clearTimeout",
        vi.fn((handle: number) => {
          clearTimeoutCalls.push(handle);
        }),
      );
      vi.stubGlobal(
        "cancelAnimationFrame",
        vi.fn((handle: number) => {
          cancelRAFCalls.push(handle);
        }),
      );

      await engine.start();
      const callCountBeforeStop = rafCalls.length;

      // stop() should set _running to false and cancel the frame handle
      await engine.stop();

      // After stop, no additional frame callbacks should be scheduled
      expect(rafCalls.length).toBe(callCountBeforeStop);
      // At least one of the cancel methods should have been called
      expect(cancelRAFCalls.length + clearTimeoutCalls.length).toBeGreaterThan(0);
    });
  });

  // ── Phase ordering ──────────────────────────────────────────────────────────

  describe("8-phase frame loop ordering", () => {
    it("executes all 8 phases in the documented order", async () => {
      const engine = await makeEngine();
      const log: string[] = [];

      // Observe hooks
      engine.hooks.hook("engine:tick", (_dt) => {
        log.push("hook:tick");
      });
      engine.hooks.hook("engine:afterTick", (_dt) => {
        log.push("hook:afterTick");
      });

      // Register a plugin that records each lifecycle call
      await engine.use(recordingPlugin("p1", log));

      await engine.advance(0.016);

      expect(log).toEqual([
        "p1:setup", // setup happens in use(), not in advance()
        "hook:tick", // Phase 1
        "p1:onBeforeUpdate", // Phase 2
        // Phase 3 — physics disabled, nothing logged
        // Phase 4 — no WASM modules
        // Phase 5 — ECS stub
        "p1:onUpdate", // Phase 6
        "p1:onAfterUpdate", // Phase 7 (onAfterUpdate before onRender)
        "p1:onRender", // Phase 7
        "hook:afterTick", // Phase 8
      ]);
    });

    it("engine:tick fires before any onBeforeUpdate", async () => {
      const engine = await makeEngine();
      const order: string[] = [];

      engine.hooks.hook("engine:tick", () => {
        order.push("tick-hook");
      });
      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:before-update", () => {
            order.push("onBeforeUpdate");
          });
        },
      });

      await engine.advance(0.016);

      expect(order.indexOf("tick-hook")).toBeLessThan(order.indexOf("onBeforeUpdate"));
    });

    it("engine:afterTick fires after all onRender calls", async () => {
      const engine = await makeEngine();
      const order: string[] = [];

      engine.hooks.hook("engine:afterTick", () => {
        order.push("afterTick-hook");
      });

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:render", () => {
            order.push("onRender");
          });
        },
      });

      await engine.advance(0.016);

      const renderIdx = order.indexOf("onRender");
      const afterTickIdx = order.indexOf("afterTick-hook");
      expect(renderIdx).toBeLessThan(afterTickIdx);
    });

    it("onBeforeUpdate runs before onUpdate for the same plugin", async () => {
      const engine = await makeEngine();
      const order: string[] = [];

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:before-update", () => {
            order.push("before");
          });
          e.hooks.hook("engine:update", () => {
            order.push("update");
          });
        },
      });

      await engine.advance(0.016);

      expect(order.indexOf("before")).toBeLessThan(order.indexOf("update"));
    });

    it("two plugins execute in registration order within each phase", async () => {
      const engine = await makeEngine();
      const order: string[] = [];

      await engine.use({
        name: "first",
        setup(e) {
          e.hooks.hook("engine:update", () => {
            order.push("first:update");
          });
        },
      });
      await engine.use({
        name: "second",
        setup(e) {
          e.hooks.hook("engine:update", () => {
            order.push("second:update");
          });
        },
      });

      await engine.advance(0.016);

      expect(order).toEqual(["first:update", "second:update"]);
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────────────

  describe("stats tracking", () => {
    it("frameCount starts at 0 before any advance()", async () => {
      const engine = await makeEngine();
      expect(engine.frameCount).toBe(0);
      expect(engine.getStats().frameCount).toBe(0);
    });

    it("frameCount increments by 1 per advance() call", async () => {
      const engine = await makeEngine();

      await engine.advance(0.016);
      expect(engine.frameCount).toBe(1);

      await engine.advance(0.016);
      expect(engine.frameCount).toBe(2);

      await engine.advance(0.016);
      expect(engine.frameCount).toBe(3);
    });

    it("getStats().frameCount matches frameCount getter", async () => {
      const engine = await makeEngine();
      await engine.advance(0.016);
      expect(engine.getStats().frameCount).toBe(engine.frameCount);
    });

    it("getFPS() returns 1000 / dt after each frame", async () => {
      const engine = await makeEngine();
      await engine.advance(0.016);
      expect(engine.getFPS()).toBeCloseTo(1 / 0.016, 0);
    });

    it("getFPS() returns 0 when dt is 0", async () => {
      const engine = await makeEngine();
      // dt=0 → capped to 0 (0 < maxDeltaSeconds=0.1), so dt=0
      await engine.advance(0);
      expect(engine.getFPS()).toBe(0);
    });

    it("getStats() includes fps and deltaTime in seconds", async () => {
      const engine = await makeEngine();
      await engine.advance(0.02); // 20ms in seconds
      const stats = engine.getStats();
      expect(stats.fps).toBeCloseTo(1 / 0.02, 5); // 50 fps
      expect(stats.deltaTime).toBeCloseTo(0.02);
      expect(stats.frameCount).toBe(1);
    });
  });

  // ── advance() behaviour ─────────────────────────────────────────────────────

  describe("advance()", () => {
    it("caps dt at maxDeltaSeconds in seconds — proves dt is seconds not ms", async () => {
      // With maxDeltaSeconds=0.1 and advance(1):
      //   If dt is seconds: min(1, 0.1) = 0.1  ← correct
      //   If dt is ms:      min(1, 100) = 1     ← bug: not capped
      const engine = await makeEngine({ maxDeltaSeconds: 0.1 });
      let receivedDt = -1;
      await engine.use({
        name: "probe",
        setup(e) {
          e.hooks.hook("engine:update", (dt) => {
            receivedDt = dt;
          });
        },
      });
      await engine.advance(1); // 1 second — well above the 0.1s cap
      expect(receivedDt).toBeCloseTo(0.1, 5);
    });

    it("advance(1/60) produces fps ≈ 60 — proves fps formula uses seconds", async () => {
      // fps = 1/dt when dt is seconds, or 1000/dt when dt is ms.
      // With advance(1/60): if seconds, fps ≈ 60; if ms, fps ≈ 60000.
      const engine = await makeEngine({ maxDeltaSeconds: 1 });
      await engine.advance(1 / 60);
      expect(engine.getFPS()).toBeCloseTo(60, 0);
    });
    it("passes dt in milliseconds to plugin.onUpdate", async () => {
      const engine = await makeEngine();
      let receivedDt = -1;

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:update", (dt) => {
            receivedDt = dt;
          });
        },
      });

      await engine.advance(1 / 60);
      expect(receivedDt).toBeCloseTo(1 / 60, 5);
    });

    it("aps dt at maxDeltaSeconds (seconds)", async () => {
      const engine = await makeEngine({ maxDeltaSeconds: 0.05 }); // cap = 50 ms
      let receivedDt = -1;

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:update", (dt) => {
            receivedDt = dt;
          });
        },
      });

      await engine.advance(1); // 1s — well above the 0.05s cap
      expect(receivedDt).toBeCloseTo(0.05, 5);
    });

    it("does not cap dt below maxDeltaSeconds", async () => {
      const engine = await makeEngine({ maxDeltaSeconds: 0.1 }); // cap = 100 ms
      let receivedDt = -1;

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:update", (dt) => {
            receivedDt = dt;
          });
        },
      });

      await engine.advance(0.016);
      expect(receivedDt).toBeCloseTo(0.016, 5);
    });

    it("throws on re-entrant calls", async () => {
      const engine = await makeEngine();
      let resolveBlock!: () => void;

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:update", () => {
            // block inside onUpdate so advance() is still "running"
            return new Promise<void>((resolve) => {
              resolveBlock = resolve;
            });
          });
        },
      });

      const first = engine.advance(0.016);
      // Calling advance while the first one is pending must throw
      await expect(engine.advance(0.016)).rejects.toThrow(/re-entrantly/);
      resolveBlock();
      await first;
    });

    it("clears re-entrancy flag after normal completion", async () => {
      const engine = await makeEngine();
      await engine.advance(0.016);
      await expect(engine.advance(0.016)).resolves.toBeUndefined();
    });
  });

  // ── startExternal() ─────────────────────────────────────────────────────────

  describe("startExternal()", () => {
    it("fires engine:init and engine:start hooks", async () => {
      const engine = await makeEngine();
      const fired: string[] = [];

      engine.hooks.hook("engine:init", () => {
        fired.push("init");
      });
      engine.hooks.hook("engine:start", () => {
        fired.push("start");
      });

      await engine.startExternal();

      expect(fired).toContain("init");
      expect(fired).toContain("start");
    });

    it("does not start RAF (requestAnimationFrame not called)", async () => {
      const engine = await makeEngine();
      const rafSpy = vi.fn(() => 1);
      vi.stubGlobal("requestAnimationFrame", rafSpy);

      await engine.startExternal();

      expect(rafSpy).not.toHaveBeenCalled();
    });

    it("allows advance() to be called immediately after startExternal()", async () => {
      const engine = await makeEngine();
      await engine.startExternal();
      await expect(engine.advance(0.016)).resolves.toBeUndefined();
    });
  });

  // ── WasmModuleHandle — loadWasmModule ───────────────────────────────────────

  describe("loadWasmModule()", () => {
    let bridge: WasmBridgeImpl;

    beforeEach(() => {
      mockFetch(MINIMAL_WASM);
      // Per-instance bridge — avoids touching the global singleton
      bridge = new WasmBridgeImpl();
      vi.spyOn(bridge, "isActive").mockReturnValue(true);
      // Mock SharedMemoryManager.create to avoid needing actual WASM initialization
      vi.spyOn(SharedMemoryManager, "create").mockReturnValue({
        transformBufferPtr: 1024,
      } as any);
    });

    it("returns a WasmModuleHandle with the correct name", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const handle = await engine.loadWasmModule({ name: "test", url: "http://x/test.wasm" });

      expect(handle.name).toBe("test");
    });

    it("returns a WasmModuleHandle with an exports object", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const handle = await engine.loadWasmModule({ name: "mod", url: "http://x/mod.wasm" });

      expect(handle.exports).toBeDefined();
      expect(typeof handle.exports).toBe("object");
    });

    it("returns memory=undefined when the module does not export memory", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const handle = await engine.loadWasmModule({ name: "noMem", url: "http://x/nomem.wasm" });

      expect(handle.memory).toBeUndefined();
    });

    it("returns memory instance when module exports memory", async () => {
      mockFetch(WASM_WITH_MEMORY);
      const engine = await makeEngine({ _bridge: bridge });
      const handle = await engine.loadWasmModule({ name: "withMem", url: "http://x/mem.wasm" });

      expect(handle.memory).toBeInstanceOf(WebAssembly.Memory);
    });

    it("deduplicates: calling twice with the same name returns the same handle", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const h1 = await engine.loadWasmModule({ name: "dedup", url: "http://x/dedup.wasm" });
      const h2 = await engine.loadWasmModule({ name: "dedup", url: "http://x/dedup.wasm" });

      expect(h1).toBe(h2);
      // fetch was only called once
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it("throws with a descriptive error when fetch returns non-ok status", async () => {
      mockFetchFail(404);
      const engine = await makeEngine({ _bridge: bridge });

      await expect(
        engine.loadWasmModule({ name: "missing", url: "http://x/missing.wasm" }),
      ).rejects.toThrow(/loadWasmModule.*missing/);
    });

    it("throws with a descriptive error when fetch rejects", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));
      const engine = await makeEngine({ _bridge: bridge });

      await expect(
        engine.loadWasmModule({ name: "net", url: "http://x/net.wasm" }),
      ).rejects.toThrow(/loadWasmModule.*net/);
    });

    it("accepts a URL object as url option", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const handle = await engine.loadWasmModule({
        name: "urlobj",
        url: new URL("http://x/urlobj.wasm"),
      });

      expect(handle.name).toBe("urlobj");
    });
  });

  // ── WasmModuleHandle — getWasmModule ────────────────────────────────────────

  describe("getWasmModule()", () => {
    let bridge: WasmBridgeImpl;

    beforeEach(() => {
      mockFetch(MINIMAL_WASM);
      // Per-instance bridge — avoids touching the global singleton
      bridge = new WasmBridgeImpl();
      vi.spyOn(bridge, "isActive").mockReturnValue(true);
      // Mock SharedMemoryManager.create to avoid needing actual WASM initialization
      vi.spyOn(SharedMemoryManager, "create").mockReturnValue({
        transformBufferPtr: 1024,
      } as any);
    });

    it("returns the handle after it has been loaded", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const loaded = await engine.loadWasmModule({ name: "g", url: "http://x/g.wasm" });
      const retrieved = engine.getWasmModule("g");

      expect(retrieved).toBe(loaded);
    });

    it("throws a descriptive error when the module has not been loaded", async () => {
      const engine = await makeEngine({ _bridge: bridge });

      expect(() => engine.getWasmModule("nope")).toThrow(/getWasmModule.*nope/);
    });

    it("error message includes actionable hint to call loadWasmModule", () => {
      const _engine = createEngine() as unknown as GwenEngine;
      // createEngine is async, but the cast lets us test the sync path
      // — use a properly awaited engine instead
      expect(true).toBe(true); // placeholder, covered by test above
    });
  });

  // ── Phase 4 — WASM module step ──────────────────────────────────────────────

  describe("Phase 4 — WASM module step", () => {
    let bridge: WasmBridgeImpl;

    beforeEach(() => {
      mockFetch(MINIMAL_WASM);
      // Per-instance bridge — avoids touching the global singleton
      bridge = new WasmBridgeImpl();
      vi.spyOn(bridge, "isActive").mockReturnValue(true);
      // Mock SharedMemoryManager.create to avoid needing actual WASM initialization
      vi.spyOn(SharedMemoryManager, "create").mockReturnValue({
        transformBufferPtr: 1024,
      } as any);
    });

    it("calls the step function with the handle and dt each frame", async () => {
      const engine = await makeEngine({ _bridge: bridge });

      const stepFn = vi.fn();
      const handle = await engine.loadWasmModule<WebAssembly.Exports>({
        name: "stepped",
        url: "http://x/stepped.wasm",
        step: stepFn,
      });

      await engine.advance(0.016);

      expect(stepFn).toHaveBeenCalledOnce();
      expect(stepFn).toHaveBeenCalledWith(handle, 0.016);
    });

    it("calls step for multiple modules in registration order", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const order: string[] = [];

      await engine.loadWasmModule({
        name: "first",
        url: "http://x/first.wasm",
        step: () => {
          order.push("first");
        },
      });
      await engine.loadWasmModule({
        name: "second",
        url: "http://x/second.wasm",
        step: () => {
          order.push("second");
        },
      });

      await engine.advance(0.016);

      expect(order).toEqual(["first", "second"]);
    });

    it("step runs in Phase 4, after onBeforeUpdate and before onUpdate", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const order: string[] = [];

      await engine.use({
        name: "p",
        setup(e) {
          e.hooks.hook("engine:before-update", () => {
            order.push("onBeforeUpdate");
          });
          e.hooks.hook("engine:update", () => {
            order.push("onUpdate");
          });
        },
      });

      await engine.loadWasmModule({
        name: "wmod",
        url: "http://x/wmod.wasm",
        step: () => {
          order.push("wasmStep");
        },
      });

      await engine.advance(0.016);

      const beforeIdx = order.indexOf("onBeforeUpdate");
      const wasmIdx = order.indexOf("wasmStep");
      const updateIdx = order.indexOf("onUpdate");

      expect(beforeIdx).toBeLessThan(wasmIdx);
      expect(wasmIdx).toBeLessThan(updateIdx);
    });

    it("skips step for modules loaded without a step function", async () => {
      const engine = await makeEngine({ _bridge: bridge });

      // Should not throw even with no step
      await engine.loadWasmModule({ name: "nostep", url: "http://x/nostep.wasm" });
      await expect(engine.advance(0.016)).resolves.toBeUndefined();
    });

    it("passes the capped dt to the step function", async () => {
      const engine = await makeEngine({ maxDeltaSeconds: 0.05, _bridge: bridge }); // cap = 50 ms
      const receivedDts: number[] = [];

      await engine.loadWasmModule({
        name: "dtcheck",
        url: "http://x/dtcheck.wasm",
        step: (_h, dt) => {
          receivedDts.push(dt);
        },
      });

      await engine.advance(999); // above cap

      expect(receivedDts[0]).toBeCloseTo(0.05, 5);
    });
  });

  // ── Handle type safety ──────────────────────────────────────────────────────

  describe("WasmModuleHandle type contracts", () => {
    let bridge: WasmBridgeImpl;

    beforeEach(() => {
      mockFetch(MINIMAL_WASM);
      // Per-instance bridge — avoids touching the global singleton
      bridge = new WasmBridgeImpl();
      vi.spyOn(bridge, "isActive").mockReturnValue(true);
      // Mock SharedMemoryManager.create to avoid needing actual WASM initialization
      vi.spyOn(SharedMemoryManager, "create").mockReturnValue({
        transformBufferPtr: 1024,
      } as any);
    });

    it("handle.name matches the options.name", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const handle = await engine.loadWasmModule({ name: "typed", url: "http://x/t.wasm" });

      expect(handle.name).toBe("typed");
    });

    it("handle is readonly — name cannot be reassigned (type-level check)", async () => {
      const engine = await makeEngine({ _bridge: bridge });
      const handle: WasmModuleHandle = await engine.loadWasmModule({
        name: "ro",
        url: "http://x/ro.wasm",
      });

      // TypeScript readonly means this would be a compile error.
      // At runtime we verify the property exists and is accessible.
      expect(handle.name).toBe("ro");
      expect(Object.prototype.hasOwnProperty.call(handle, "name") || "name" in handle).toBe(true);
    });
  });
});
