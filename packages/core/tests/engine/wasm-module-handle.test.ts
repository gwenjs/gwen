/**
 * @file Tests for WasmRingBuffer byteOffset resolution and WasmRegionView.
 */

import { describe, it, expect, vi } from 'vitest';
import { WasmRingBuffer, WasmRegionView } from '../../src/engine/wasm-module-handle';

describe('WasmRingBuffer byteOffset resolution', () => {
  /**
   * Create a mock WASM memory with sufficient pages.
   */
  function createMockMemory(pageSizeKB: number = 256): WebAssembly.Memory {
    return {
      buffer: new SharedArrayBuffer(pageSizeKB * 1024),
      grow: () => 1,
    } as WebAssembly.Memory;
  }

  describe('byteOffset priority: explicit > auto-detect > fallback', () => {
    it('uses explicit opts.byteOffset when provided', () => {
      const memory = createMockMemory();
      const explicitOffset = 512;
      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 10,
          itemByteSize: 4,
          byteOffset: explicitOffset,
        },
        undefined, // No exports
      );

      // Push data and verify it appears at the explicit offset, not elsewhere.
      const data = new Uint32Array([42]);
      expect(buffer.push(data)).toBe(true);

      // Inspect raw memory at the explicit offset to confirm data landed there.
      const dataView = new DataView(memory.buffer as ArrayBuffer);
      // Ring buffer stores items after the head/tail indices at [byteOffset + slot*itemByteSize].
      // First item should be at byteOffset + 0 * itemByteSize = byteOffset.
      const valueAtOffset = dataView.getUint32(explicitOffset, true); // little-endian
      expect(valueAtOffset).toBe(42);

      // Also verify that offset 65536 (the fallback) remains untouched (zero).
      const fallbackValue = dataView.getUint32(65536, true);
      expect(fallbackValue).toBe(0);
    });

    it('calls gwen_{name}_ring_ptr() export when available', () => {
      const memory = createMockMemory();
      const detectedOffset = 1024; // Well within our 256KB buffer
      const ptrFn = vi.fn(() => detectedOffset);
      const mockExports = {
        gwen_test_ring_ptr: ptrFn,
      } as unknown as WebAssembly.Exports;

      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 10,
          itemByteSize: 4,
        },
        mockExports,
      );

      // Push data and verify the export was called.
      const data = new Uint32Array([123]);
      expect(buffer.push(data)).toBe(true);
      expect(ptrFn).toHaveBeenCalledOnce();

      // Inspect raw memory to confirm data landed at the detected offset.
      const dataView = new DataView(memory.buffer as ArrayBuffer);
      const valueAtDetectedOffset = dataView.getUint32(detectedOffset, true); // little-endian
      expect(valueAtDetectedOffset).toBe(123);

      // Verify that offset 512 (alternative) and 65536 (fallback) remain untouched.
      expect(dataView.getUint32(512, true)).toBe(0);
      expect(dataView.getUint32(65536, true)).toBe(0);
    });

    it.each([
      ['no export in exports object', {} as WebAssembly.Exports],
      ['undefined exports parameter', undefined],
    ])('falls back to 65536 when %s', (_label, exports) => {
      const memory = createMockMemory();
      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 10,
          itemByteSize: 4,
        },
        exports,
      );

      // Verify the buffer works (uses fallback offset of 65536).
      const data = new Uint32Array([999]);
      expect(buffer.push(data)).toBe(true);

      // Inspect raw memory to confirm data landed at the fallback offset.
      const dataView = new DataView(memory.buffer as ArrayBuffer);
      const valueAtFallback = dataView.getUint32(65536, true); // little-endian
      expect(valueAtFallback).toBe(999); // First item at offset + 0*itemByteSize

      // Verify that offset 512 (explicit) and 1024 (export) remain untouched (zero).
      expect(dataView.getUint32(512, true)).toBe(0);
      expect(dataView.getUint32(1024, true)).toBe(0);
    });

    it('prefers opts.byteOffset over exports', () => {
      const memory = createMockMemory();
      const explicitOffset = 512;
      const detectedOffset = 1024;
      const mockExports = {
        gwen_test_ring_ptr: () => detectedOffset,
      } as unknown as WebAssembly.Exports;

      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 10,
          itemByteSize: 4,
          byteOffset: explicitOffset,
        },
        mockExports,
      );

      // Push data and verify it uses the explicit offset, not the export.
      const data = new Uint32Array([555]);
      expect(buffer.push(data)).toBe(true);

      // Inspect raw memory to confirm data landed at the explicit offset.
      const dataView = new DataView(memory.buffer as ArrayBuffer);
      const valueAtExplicit = dataView.getUint32(explicitOffset, true); // little-endian
      expect(valueAtExplicit).toBe(555);

      // Verify that offset 1024 (what export would return) remains zero.
      expect(dataView.getUint32(detectedOffset, true)).toBe(0);
    });

    it('handles non-function exports gracefully (ignores them)', () => {
      const memory = createMockMemory();
      const mockExports = {
        gwen_test_ring_ptr: 42, // Not a function
      } as unknown as WebAssembly.Exports;

      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 10,
          itemByteSize: 4,
        },
        mockExports,
      );

      // Should fall back to 65536 since the export is not a function.
      const data = new Uint32Array([888]);
      expect(buffer.push(data)).toBe(true);

      const dest = new Uint32Array(1);
      expect(buffer.pop(dest)).toBe(true);
      expect(dest[0]).toBe(888);
    });

    it('calls different ring_ptr exports for different channel names', () => {
      const memory = createMockMemory();
      const cmdOffset = 1024;
      const responseOffset = 2048;

      const mockExports = {
        gwen_commands_ring_ptr: () => cmdOffset,
        gwen_responses_ring_ptr: () => responseOffset,
      } as unknown as WebAssembly.Exports;

      const cmdBuffer = new WasmRingBuffer(
        memory,
        {
          name: 'commands',
          direction: 'ts→wasm',
          capacity: 10,
          itemByteSize: 4,
        },
        mockExports,
      );

      const respBuffer = new WasmRingBuffer(
        memory,
        {
          name: 'responses',
          direction: 'wasm→ts',
          capacity: 10,
          itemByteSize: 4,
        },
        mockExports,
      );

      // Both should work independently.
      const data1 = new Uint32Array([111]);
      expect(cmdBuffer.push(data1)).toBe(true);

      const data2 = new Uint32Array([222]);
      expect(respBuffer.push(data2)).toBe(true);

      const dest1 = new Uint32Array(1);
      expect(cmdBuffer.pop(dest1)).toBe(true);
      expect(dest1[0]).toBe(111);

      const dest2 = new Uint32Array(1);
      expect(respBuffer.pop(dest2)).toBe(true);
      expect(dest2[0]).toBe(222);
    });
  });

  describe('ring buffer operations at correct offset', () => {
    it('push() and pop() work correctly at detected offset', () => {
      const memory = createMockMemory();
      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 5,
          itemByteSize: 4,
        },
        {}, // Falls back to 65536
      );

      // Push multiple items.
      const items = [100, 200, 300];
      for (const item of items) {
        const data = new Uint32Array([item]);
        expect(buffer.push(data)).toBe(true);
      }

      expect(buffer.length).toBe(3);
      expect(buffer.empty).toBe(false);
      expect(buffer.full).toBe(false);

      // Pop all items.
      const results: number[] = [];
      const dest = new Uint32Array(1);
      while (buffer.pop(dest)) {
        results.push(dest[0]);
      }

      expect(results).toEqual([100, 200, 300]);
      expect(buffer.empty).toBe(true);
    });

    it('respects capacity from channel options', () => {
      const memory = createMockMemory();
      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 4,
          itemByteSize: 4,
        },
        {},
      );

      // Fill to capacity - note: ring buffer capacity N can hold N-1 items
      // because (tail+1) % capacity === head when full.
      const data = new Uint32Array([1]);
      expect(buffer.push(data)).toBe(true);
      expect(buffer.push(data)).toBe(true);
      expect(buffer.push(data)).toBe(true);

      // Next push should fail (full).
      expect(buffer.full).toBe(true);
      expect(buffer.push(data)).toBe(false);
    });

    it('wraps around on ring buffer operations', () => {
      const memory = createMockMemory();
      const buffer = new WasmRingBuffer(
        memory,
        {
          name: 'test',
          direction: 'ts→wasm',
          capacity: 4,
          itemByteSize: 4,
        },
        {},
      );

      const dest = new Uint32Array(1);

      // Push 3 items.
      let data = new Uint32Array([1]);
      buffer.push(data);
      data = new Uint32Array([2]);
      buffer.push(data);
      data = new Uint32Array([3]);
      buffer.push(data);

      // Pop 2, push 2 (tests wrap-around).
      buffer.pop(dest);
      buffer.pop(dest);
      data = new Uint32Array([99]);
      buffer.push(data);
      data = new Uint32Array([98]);
      buffer.push(data);

      expect(buffer.length).toBe(3);

      // Verify items are still in correct order.
      buffer.pop(dest);
      expect(dest[0]).toBe(3);
      buffer.pop(dest);
      expect(dest[0]).toBe(99);
      buffer.pop(dest);
      expect(dest[0]).toBe(98);
    });
  });

  describe('WasmRegionView', () => {
    it('creates live typed views into memory regions', () => {
      const memory = createMockMemory();
      const view = new WasmRegionView(memory, {
        name: 'test-region',
        byteOffset: 0,
        byteLength: 256,
        type: 'f32',
      });

      // Write to the region via f32 view.
      const f32View = view.f32;
      f32View[0] = 1.5;
      f32View[1] = 2.5;

      // Read back and verify.
      expect(view.f32[0]).toBe(1.5);
      expect(view.f32[1]).toBe(2.5);
    });

    it('provides multiple typed views (u8, u32, f32, etc.)', () => {
      const memory = createMockMemory();
      const view = new WasmRegionView(memory, {
        name: 'test-region',
        byteOffset: 0,
        byteLength: 256,
        type: 'u32',
      });

      // Test various typed views.
      const u8 = view.u8;
      u8[0] = 255;
      expect(u8[0]).toBe(255);

      const u32 = view.u32;
      u32[0] = 0xdeadbeef;
      expect(u32[0]).toBe(0xdeadbeef);

      const f32 = view.f32;
      f32[0] = 3.14159;
      expect(Math.abs(f32[0] - 3.14159) < 0.001).toBe(true);
    });

    it('buffer property returns a copy, not a live view', () => {
      const memory = createMockMemory();
      const view = new WasmRegionView(memory, {
        name: 'test-region',
        byteOffset: 0,
        byteLength: 16,
        type: 'u8',
      });

      // Write to region
      view.u8[0] = 42;
      const snapshot = view.buffer; // copy taken here

      // Mutate after snapshot
      view.u8[0] = 99;

      // Snapshot must not reflect the later mutation
      expect(new Uint8Array(snapshot as ArrayBuffer)[0]).toBe(42);
    });
  });
});
