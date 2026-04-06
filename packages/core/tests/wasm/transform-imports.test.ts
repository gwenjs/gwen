/**
 * Tests for buildTransformImports host-function bridge.
 *
 * Verifies that the function builds closures that return the correct values
 * and that each accessor is callable multiple times (returning fresh values).
 */

import { describe, it, expect } from 'vitest';
import { buildTransformImports, type GwenTransformImports } from '../../src/wasm/transform-imports';

describe('buildTransformImports', () => {
  it('returns an object with three functions', () => {
    const imports = buildTransformImports(1024, 32, 10_000);
    expect(imports).toHaveProperty('transform_buffer_ptr');
    expect(imports).toHaveProperty('transform_stride');
    expect(imports).toHaveProperty('max_entities');
    expect(typeof imports.transform_buffer_ptr).toBe('function');
    expect(typeof imports.transform_stride).toBe('function');
    expect(typeof imports.max_entities).toBe('function');
  });

  it('returns transform_buffer_ptr that returns the given ptr', () => {
    const ptr = 2048;
    const imports = buildTransformImports(ptr, 32, 10_000);
    expect(imports.transform_buffer_ptr()).toBe(ptr);
    expect(imports.transform_buffer_ptr()).toBe(ptr);
  });

  it('returns transform_stride that returns the given stride', () => {
    const stride = 32;
    const imports = buildTransformImports(1024, stride, 10_000);
    expect(imports.transform_stride()).toBe(stride);
    expect(imports.transform_stride()).toBe(stride);
  });

  it('returns max_entities that returns the given maxEntities', () => {
    const maxEntities = 5_000;
    const imports = buildTransformImports(1024, 32, maxEntities);
    expect(imports.max_entities()).toBe(maxEntities);
    expect(imports.max_entities()).toBe(maxEntities);
  });

  it('handles zero ptr (edge case)', () => {
    const imports = buildTransformImports(0, 32, 10_000);
    expect(imports.transform_buffer_ptr()).toBe(0);
  });

  it('handles large ptr values', () => {
    const ptr = 1_000_000_000; // 1 billion
    const imports = buildTransformImports(ptr, 32, 10_000);
    expect(imports.transform_buffer_ptr()).toBe(ptr);
  });

  it('handles various stride values', () => {
    const strides = [32, 48, 64];
    for (const stride of strides) {
      const imports = buildTransformImports(1024, stride, 10_000);
      expect(imports.transform_stride()).toBe(stride);
    }
  });

  it('handles various maxEntities values', () => {
    const counts = [100, 1_000, 10_000, 100_000];
    for (const count of counts) {
      const imports = buildTransformImports(1024, 32, count);
      expect(imports.max_entities()).toBe(count);
    }
  });

  it('isolates values between separate imports objects', () => {
    const importsA = buildTransformImports(100, 32, 1_000);
    const importsB = buildTransformImports(200, 48, 2_000);

    // Modifying importsA should not affect importsB (functions are independent closures)
    expect(importsA.transform_buffer_ptr()).toBe(100);
    expect(importsB.transform_buffer_ptr()).toBe(200);

    expect(importsA.transform_stride()).toBe(32);
    expect(importsB.transform_stride()).toBe(48);

    expect(importsA.max_entities()).toBe(1_000);
    expect(importsB.max_entities()).toBe(2_000);
  });

  it('handles negative values (no validation — caller responsibility)', () => {
    // buildTransformImports does not validate; it's up to the caller to ensure valid values.
    // This test documents that behavior.
    const imports = buildTransformImports(-1, -1, -1);
    expect(imports.transform_buffer_ptr()).toBe(-1);
    expect(imports.transform_stride()).toBe(-1);
    expect(imports.max_entities()).toBe(-1);
  });

  it('accessors return fresh values each call (not cached stale)', () => {
    const imports = buildTransformImports(1024, 32, 10_000);
    // Each call should return the same value (closure stability)
    expect(imports.transform_buffer_ptr()).toBe(1024);
    expect(imports.transform_buffer_ptr()).toBe(1024);
    expect(imports.transform_stride()).toBe(32);
    expect(imports.transform_stride()).toBe(32);
    expect(imports.max_entities()).toBe(10_000);
    expect(imports.max_entities()).toBe(10_000);
  });

  it('integrates with WebAssembly import pattern', () => {
    // Simulate passing to WebAssembly.instantiate(buffer, { gwen: imports })
    const imports = buildTransformImports(1024, 32, 10_000);
    const importObject = { gwen: imports };

    // Verify structure that WebAssembly expects
    expect(importObject.gwen).toBeDefined();
    expect(typeof importObject.gwen.transform_buffer_ptr).toBe('function');
    expect(typeof importObject.gwen.transform_stride).toBe('function');
    expect(typeof importObject.gwen.max_entities).toBe('function');

    // Verify they're callable
    expect(() => {
      importObject.gwen.transform_buffer_ptr();
      importObject.gwen.transform_stride();
      importObject.gwen.max_entities();
    }).not.toThrow();
  });
});
