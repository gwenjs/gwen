/**
 * Tests for SharedMemoryManager and MAX_SAB_BYTES overallocation guard.
 *
 * The overallocation guard prevents silent OOM crashes by throwing a
 * GwenConfigError when the requested allocation would exceed MAX_SAB_BYTES.
 *
 * ## Bytes-per-entity formula (from shared-memory.ts)
 * ```
 * totalBytes = maxEntities * TRANSFORM_STRIDE + sentinelHeadroom
 *            = maxEntities * 32 + 1024
 * ```
 *
 * Threshold for overflow:
 *   maxEntities > (MAX_SAB_BYTES - 1024) / 32
 *               > (268_435_456 - 1024) / 32
 *               > 8_388_576
 *
 * So `maxEntities = 8_389_000` reliably exceeds the 256 MiB limit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SharedMemoryManager,
  MAX_SAB_BYTES,
  TRANSFORM_STRIDE,
} from '../../src/wasm/shared-memory.js';
import { GwenConfigError } from '../../src/engine/config-error.js';
import type { WasmBridge } from '../../src/engine/wasm-bridge.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock WasmBridge that reports itself as active and returns a
 * non-null pointer from allocSharedBuffer.
 *
 * @param allocPtr  Fake WASM pointer returned by allocSharedBuffer (default: 1024).
 */
function makeMockBridge(allocPtr = 1024): WasmBridge {
  return {
    isActive: vi.fn(() => true),
    allocSharedBuffer: vi.fn(() => allocPtr),
    getLinearMemory: vi.fn(() => null),
  } as unknown as WasmBridge;
}

// ─── MAX_SAB_BYTES constant ───────────────────────────────────────────────────

describe('MAX_SAB_BYTES', () => {
  it('equals 256 MiB', () => {
    expect(MAX_SAB_BYTES).toBe(256 * 1024 * 1024);
  });

  it('is large enough for 2_000_000 entities at TRANSFORM_STRIDE bytes each', () => {
    const bytesFor2M = 2_000_000 * TRANSFORM_STRIDE;
    expect(bytesFor2M).toBeLessThan(MAX_SAB_BYTES);
  });
});

// ─── SharedMemoryManager.create() — overallocation guard ─────────────────────

describe('SharedMemoryManager.create()', () => {
  let bridge: WasmBridge;

  beforeEach(() => {
    bridge = makeMockBridge();
  });

  it('throws GwenConfigError when maxEntities would exceed 256 MiB', () => {
    // 8_389_000 * 32 + 1024 = 268_449_024 bytes > 268_435_456 (256 MiB)
    const oversized = 8_389_000;

    expect(() => SharedMemoryManager.create(bridge, oversized)).toThrow(GwenConfigError);
  });

  it('GwenConfigError for oversized maxEntities has field "maxEntities"', () => {
    const oversized = 8_389_000;

    let caught: unknown;
    try {
      SharedMemoryManager.create(bridge, oversized);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GwenConfigError);
    const err = caught as GwenConfigError;
    expect(err.field).toBe('maxEntities');
    expect(err.value).toBe(oversized);
  });

  it('GwenConfigError message mentions the MiB figures', () => {
    const oversized = 8_389_000;

    let caught: unknown;
    try {
      SharedMemoryManager.create(bridge, oversized);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(GwenConfigError);
    const err = caught as GwenConfigError;
    // The hint should contain both the requested size and the 256 MiB limit
    expect(err.hint).toMatch(/MiB/);
    expect(err.hint).toMatch(/256/);
  });

  it('does not throw for maxEntities within safe limits (10_000)', () => {
    expect(() => SharedMemoryManager.create(bridge, 10_000)).not.toThrow();
  });

  it('does not throw for default maxEntities', () => {
    // Default is 10_000 — well within limits
    expect(() => SharedMemoryManager.create(bridge)).not.toThrow();
  });

  it('does not call allocSharedBuffer when overallocation guard fires', () => {
    const oversized = 8_389_000;

    try {
      SharedMemoryManager.create(bridge, oversized);
    } catch {
      // expected
    }

    expect(bridge.allocSharedBuffer).not.toHaveBeenCalled();
  });

  it('calls allocSharedBuffer for safe maxEntities values', () => {
    SharedMemoryManager.create(bridge, 10_000);
    expect(bridge.allocSharedBuffer).toHaveBeenCalledOnce();
  });

  it('throws Error (not GwenConfigError) when bridge is not active', () => {
    const inactiveBridge = {
      isActive: vi.fn(() => false),
      allocSharedBuffer: vi.fn(() => 0),
      getLinearMemory: vi.fn(() => null),
    } as unknown as WasmBridge;

    expect(() => SharedMemoryManager.create(inactiveBridge, 10_000)).toThrow(Error);
    expect(() => SharedMemoryManager.create(inactiveBridge, 10_000)).not.toThrow(GwenConfigError);
  });

  it('throws Error (not GwenConfigError) when allocSharedBuffer returns null pointer', () => {
    const nullPtrBridge = makeMockBridge(0 /* null ptr */);

    expect(() => SharedMemoryManager.create(nullPtrBridge, 10_000)).toThrow(Error);
    expect(() => SharedMemoryManager.create(nullPtrBridge, 10_000)).not.toThrow(GwenConfigError);
  });

  it('maxEntities just below the threshold does not throw', () => {
    // (MAX_SAB_BYTES - 1024) / 32 = 8_388_576 → exact boundary, should NOT throw
    const atBoundary = 8_388_576;
    expect(() => SharedMemoryManager.create(bridge, atBoundary)).not.toThrow();
  });

  it('maxEntities exactly one over the threshold throws GwenConfigError', () => {
    // 8_388_577 * 32 + 1024 = 268_435_488 > 268_435_456
    const justOver = 8_388_577;
    expect(() => SharedMemoryManager.create(bridge, justOver)).toThrow(GwenConfigError);
  });
});
