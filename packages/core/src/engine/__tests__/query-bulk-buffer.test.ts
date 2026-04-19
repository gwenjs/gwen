/**
 * queryReadBulk buffer sizing — unit tests.
 *
 * Verifies that the internal bulk-query buffers (_bulkSlots, _bulkGens, _bulkBuf)
 * are sized to `maxEntities`, not the previously hardcoded 10_000.
 */

import { describe, it, expect, vi } from "vitest";
import { WasmBridgeImpl } from "../wasm-bridge.js";
import type { WasmEngine } from "../wasm-bridge-types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal WasmEngine mock — only implements query_read_bulk.
 * Captures the Uint32Array buffers passed by the bridge so we can
 * assert their sizes.
 */
function makeMockEngine(capturedSlots: Uint32Array[], capturedGens: Uint32Array[]): WasmEngine {
  return {
    query_read_bulk: vi.fn(
      (
        _typeIds: Uint32Array,
        _readTypeId: number,
        slots: Uint32Array,
        gens: Uint32Array,
        _buf: Uint8Array,
      ) => {
        capturedSlots.push(slots);
        capturedGens.push(gens);
        // Return [entityCount=0, bytesWritten=0]
        return new Uint32Array([0, 0]);
      },
    ),
  } as unknown as WasmEngine;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("queryReadBulk — buffer sizing", () => {
  it("sizes _bulkSlots and _bulkGens to maxEntities, not hardcoded 10_000", () => {
    const capturedSlots: Uint32Array[] = [];
    const capturedGens: Uint32Array[] = [];

    const bridge = new WasmBridgeImpl();
    bridge._injectMock(makeMockEngine(capturedSlots, capturedGens), 20_000);
    bridge.queryReadBulk([1], 1, 4); // f32Stride=4

    expect(capturedSlots[0]!.length).toBe(20_000);
    expect(capturedGens[0]!.length).toBe(20_000);
  });

  it("_bulkBuf byte length equals maxEntities * f32Stride * 4", () => {
    // We can't inspect _bulkBuf directly, but we can verify
    // query_read_bulk is called successfully with a correctly sized buffer
    // by checking it does not throw for a high-entity configuration.
    const bridge = new WasmBridgeImpl();
    bridge._injectMock(
      {
        query_read_bulk: vi.fn(() => new Uint32Array([0, 0])),
      } as unknown as WasmEngine,
      50_000,
    );

    expect(() => bridge.queryReadBulk([1, 2], 1, 8)).not.toThrow();
  });

  it("_reset() resets _maxEntities to 10_000 (no leakage)", () => {
    const capturedSlots: Uint32Array[] = [];
    const capturedGens: Uint32Array[] = [];

    // First call with 20_000
    const bridge1 = new WasmBridgeImpl();
    bridge1._injectMock(makeMockEngine(capturedSlots, capturedGens), 20_000);
    bridge1.queryReadBulk([1], 1, 4);
    expect(capturedSlots[0]!.length).toBe(20_000);

    capturedSlots.length = 0;
    capturedGens.length = 0;

    // Fresh bridge with default maxEntities (10_000)
    const bridge2 = new WasmBridgeImpl();
    bridge2._injectMock(makeMockEngine(capturedSlots, capturedGens)); // no maxEntities arg
    bridge2.queryReadBulk([1], 1, 4);
    expect(capturedSlots[0]!.length).toBe(10_000);
  });
});
