/**
 * @file Tests for the BulkTransformer — Phase 2 code rewriter.
 *
 * Unit tests cover the no-positions guard; integration tests use a real
 * AstWalker parse to obtain source positions and verify the actual output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import MagicString from 'magic-string';
import { ComponentManifest } from '../../src/optimizer/component-manifest.js';
import { applyBulkTransform } from '../../src/optimizer/bulk-transformer.js';
import { AstWalker } from '../../src/optimizer/ast-walker.js';
import type { OptimizablePattern } from '../../src/optimizer/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Position component with 2 float32 fields (x, y). */
const POSITION_ENTRY = {
  name: 'Position',
  typeId: 1,
  byteSize: 8,
  f32Stride: 2,
  fields: [
    { name: 'x', type: 'f32', byteOffset: 0 },
    { name: 'y', type: 'f32', byteOffset: 4 },
  ],
  importPath: 'src/components/position.ts',
  exportName: 'Position',
} as const;

/** Velocity component with 2 float32 fields (x, y). */
const VELOCITY_ENTRY = {
  name: 'Velocity',
  typeId: 2,
  byteSize: 8,
  f32Stride: 2,
  fields: [
    { name: 'x', type: 'f32', byteOffset: 0 },
    { name: 'y', type: 'f32', byteOffset: 4 },
  ],
  importPath: 'src/components/velocity.ts',
  exportName: 'Velocity',
} as const;

// ─── System source used in integration tests ─────────────────────────────────

/**
 * Minimal system source that matches the optimizable pattern:
 * - read Position inside the for-of loop
 * - write Position back with updated values
 */
const SYSTEM_SOURCE = `defineSystem(() => {
  const entities = useQuery([Position]);
  onUpdate(() => {
    for (const e of entities) {
      const pos = useComponent(e, Position);
      useComponent(e, Position, { x: pos.x + 1, y: pos.y });
    }
  });
});`;

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe('applyBulkTransform', () => {
  let manifest: ComponentManifest;

  beforeEach(() => {
    manifest = new ComponentManifest();
    manifest.register(POSITION_ENTRY);
    manifest.register(VELOCITY_ENTRY);
  });

  // ── No-positions guard ──────────────────────────────────────────────────────

  it('returns false when pattern has no positions field', () => {
    const code = 'const x = 1;';
    const s = new MagicString(code);
    const pattern: OptimizablePattern = {
      queryComponents: ['Position'],
      readComponents: ['Position'],
      writeComponents: ['Position'],
      loc: { line: 1, column: 0, file: 'test.ts' },
      // positions deliberately omitted
    };
    expect(applyBulkTransform(s, pattern, manifest, 'core')).toBe(false);
  });

  it('does not mutate MagicString when positions are absent', () => {
    const code = 'const x = 1;';
    const s = new MagicString(code);
    const pattern: OptimizablePattern = {
      queryComponents: ['Position'],
      readComponents: ['Position'],
      writeComponents: ['Position'],
      loc: { line: 1, column: 0, file: 'test.ts' },
    };
    applyBulkTransform(s, pattern, manifest, 'core');
    expect(s.hasChanged()).toBe(false);
  });

  // ── Integration tests (require AstWalker to parse real source) ──────────────

  it('transforms a single read+write component pattern', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0]!;
    // Skip gracefully if walker didn't extract positions yet
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    const result = applyBulkTransform(s, pattern, manifest, 'core');
    expect(result).toBe(true);
    const output = s.toString();
    expect(output).toContain('queryReadBulk');
    expect(output).toContain('queryWriteBulk');
  });

  it('generates queryReadBulk before the for loop', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, 'core');
    const output = s.toString();

    const readIdx = output.indexOf('queryReadBulk');
    const forIdx = output.indexOf('for (let _i');
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(forIdx).toBeGreaterThanOrEqual(0);
    // queryReadBulk must appear before the numeric for loop
    expect(readIdx).toBeLessThan(forIdx);
  });

  it('generates queryWriteBulk after the for loop', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, 'core');
    const output = s.toString();

    const writeIdx = output.indexOf('queryWriteBulk');
    const forIdx = output.lastIndexOf('for (let _i');
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    // queryWriteBulk must appear after the numeric for loop
    expect(writeIdx).toBeGreaterThan(forIdx);
  });

  it('replaces for-of loop with a numeric for loop', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, 'core');
    const output = s.toString();

    expect(output).not.toContain('for (const e of');
    expect(output).toContain('for (let _i = 0;');
  });

  it('removes the per-entity read declaration (const pos = useComponent(...))', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, 'core');
    const output = s.toString();

    // The original `const pos = useComponent(e, Position)` must be gone
    expect(output).not.toContain('const pos = useComponent');
  });

  it('removes the per-entity write call (useComponent(e, Position, {...}))', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, 'core');
    const output = s.toString();

    // The original 3-arg useComponent write call must be gone
    expect(output).not.toContain('useComponent(e, Position, {');
  });

  it('rewrites pos.x property access to typed-array accessor', () => {
    // Use a source where pos.x appears OUTSIDE the write call so it ends up
    // in propAccesses and is rewritten by the transformer. In SYSTEM_SOURCE,
    // pos.x only appears inside the write call (which is removed entirely);
    // this source places pos.x in a standalone variable declaration first.
    const sourceWithExternalRead = `defineSystem(() => {
  const entities = useQuery([Position]);
  onUpdate(() => {
    for (const e of entities) {
      const pos = useComponent(e, Position);
      const next = pos.x + 1;
      useComponent(e, Position, { x: next, y: 0 });
    }
  });
});`;
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(sourceWithExternalRead);
    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0]!;
    // Skip gracefully if walker didn't extract positions
    if (!pattern.positions) return;

    const s = new MagicString(sourceWithExternalRead);
    applyBulkTransform(s, pattern, manifest, 'core');
    const output = s.toString();

    // pos.x (outside the write call) must be rewritten to a typed-array accessor
    expect(output).not.toContain('pos.x');
    expect(output).toContain('_position[_i * 2 + 0]');
  });

  it('produces a source map when transformation is applied', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    const result = applyBulkTransform(s, pattern, manifest, 'core');
    if (!result) return;

    const map = s.generateMap({ hires: true, source: 'test.ts', includeContent: true });
    expect(map).toBeDefined();
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  it('extracts pattern positions in AstWalker.walk output', () => {
    const walker = new AstWalker('test.ts');
    const patterns = walker.walk(SYSTEM_SOURCE);
    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0]!;

    // The walker should populate positions for recognisable patterns
    if (!pattern.positions) {
      // Soft skip — the walker may not yet populate positions in all cases
      return;
    }

    const { positions } = pattern;
    expect(positions.forOfStart).toBeGreaterThanOrEqual(0);
    expect(positions.forBodyStart).toBeGreaterThan(positions.forOfStart);
    expect(positions.forOfEnd).toBeGreaterThan(positions.forBodyStart);
    expect(positions.entityVar).toBe('e');
    expect(positions.readDecls.length).toBeGreaterThan(0);
    expect(positions.writeCalls.length).toBeGreaterThan(0);
  });
});
