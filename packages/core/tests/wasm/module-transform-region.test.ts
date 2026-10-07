import { afterEach, describe, expect, it, vi } from "vitest";

import type { GwenErrorPayload } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError, GwenWasmPanicError } from "../../src/engine/engine-errors.js";
import { createEngine, type GwenEngine } from "../../src/engine/gwen-engine.js";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";

const MAX_ENTITIES = 4;
const COPY_BYTES = MAX_ENTITIES * 32;
const REGION_OFFSET = 64;

const WASM_WITH_MEMORY = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x0a, 0x01,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

function regionModule(name: string, step?: (dt: number) => void) {
  return {
    name,
    url: "http://x/mod.wasm",
    memory: {
      regions: [
        { name: "transforms", byteOffset: REGION_OFFSET, byteLength: COPY_BYTES, type: "f32" as const },
      ],
    },
    transformRegion: "transforms",
    step: step === undefined ? undefined : (_handle: unknown, dt: number) => step(dt),
  };
}

describe("transform region copy counts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function boot(): Promise<{
    engine: GwenEngine;
    fill: ReturnType<typeof vi.spyOn>;
    copies: number[];
  }> {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(WASM_WITH_MEMORY, { status: 200 })),
    );
    const bridge = new WasmBridgeImpl();
    const coreMemory = new WebAssembly.Memory({ initial: 1 });
    vi.spyOn(bridge, "isActive").mockImplementation(() => true);
    vi.spyOn(bridge, "allocSharedBuffer").mockImplementation(() => REGION_OFFSET);
    vi.spyOn(bridge, "freeSharedBuffer").mockImplementation(() => undefined);
    vi.spyOn(bridge, "getLinearMemory").mockImplementation(() => coreMemory);
    const fill = vi.spyOn(bridge, "syncTransformsToBuffer").mockImplementation(() => undefined);
    const copies: number[] = [];
    const originalSet = Uint8Array.prototype.set;
    vi.spyOn(Uint8Array.prototype, "set").mockImplementation(function recordSet(
      this: Uint8Array,
      source: ArrayLike<number>,
      offset?: number,
    ) {
      if (source instanceof Uint8Array && source.length === COPY_BYTES && this.length === COPY_BYTES) {
        copies.push(this.byteOffset);
      }
      originalSet.call(this, source, offset);
    });
    const engine = await createEngine({ maxEntities: MAX_ENTITIES, _bridge: bridge });
    return { engine, fill, copies };
  }

  it("fills once per frame and copies once per region module", async () => {
    const { engine, fill, copies } = await boot();
    try {
      await engine.loadWasmModule(regionModule("a"));
      await engine.loadWasmModule(regionModule("b"));
      await engine.advance(0.016);
      await engine.advance(0.016);
      expect(fill).toHaveBeenCalledTimes(2);
      expect(copies).toEqual([REGION_OFFSET, REGION_OFFSET, REGION_OFFSET, REGION_OFFSET]);
    } finally {
      await engine.stop();
    }
  });

  it("does not copy an isolated module", async () => {
    const { engine, fill, copies } = await boot();
    await engine.loadWasmModule(
      regionModule("boom", () => {
        throw new Error("step failed");
      }),
    );
    await engine.advance(0.016);
    const firstFrameCopies = copies.length;
    copies.length = 0;
    const fillsAfterFirst = fill.mock.calls.length;
    await engine.advance(0.016);
    expect(firstFrameCopies).toBe(1);
    expect(copies).toEqual([]);
    expect(fill.mock.calls.length).toBe(fillsAfterFirst);
    await engine.stop();
  });

  it("skips copies after a recoverable fill error and still steps", async () => {
    const { engine, fill, copies } = await boot();
    fill.mockImplementation(() => {
      throw new GwenWasmError(
        CoreErrorCodes.INVALID_SHARED_BUFFER,
        "invalid shared buffer",
        "sync_transforms_to_buffer",
        new Error("cause"),
      );
    });
    const seen: GwenErrorPayload[] = [];
    const unsubscribe = engine.errors.on((event: GwenErrorPayload) => {
      seen.push(event);
    });
    let stepped = false;
    try {
      await engine.loadWasmModule(
        regionModule("a", () => {
          stepped = true;
        }),
      );
      await engine.advance(0.016);
      expect(fill).toHaveBeenCalledTimes(1);
      expect(copies).toEqual([]);
      expect(stepped).toBe(true);
      expect(engine.state).not.toBe("faulted");
      const payload = seen.find((event) => event.code === CoreErrorCodes.INVALID_SHARED_BUFFER);
      expect(payload?.code).toBe(CoreErrorCodes.INVALID_SHARED_BUFFER);
      expect(payload?.source).toBe("gwen_core.wasm");
    } finally {
      unsubscribe();
      await engine.stop();
    }
  });

  it("does not step modules after the fill traps", async () => {
    const { engine, fill } = await boot();
    fill.mockImplementation(() => {
      throw new GwenWasmPanicError(
        "sync_transforms_to_buffer",
        new WebAssembly.RuntimeError("trap"),
      );
    });
    let stepped = false;
    await engine.loadWasmModule(
      regionModule("a", () => {
        stepped = true;
      }),
    );
    await engine.advance(0.016);
    expect(stepped).toBe(false);
    await engine.stop();
  });
});
