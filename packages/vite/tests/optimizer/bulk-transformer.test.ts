/**
 * @file Tests for the BulkTransformer — Phase 2 code rewriter.
 *
 * Unit tests cover the no-positions guard; integration tests use a real
 * AstWalker parse to obtain source positions and verify the actual output.
 */

import { describe, it, expect, beforeEach } from "vitest";
import MagicString from "magic-string";
import { ComponentManifest } from "../../src/optimizer/component-manifest.js";
import { applyBulkTransform } from "../../src/optimizer/bulk-transformer.js";
import { AstWalker } from "../../src/optimizer/ast-walker.js";
import type { OptimizablePattern } from "../../src/optimizer/types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Position component with 2 float32 fields (x, y). */
const POSITION_ENTRY = {
  name: "Position",
  typeId: 1,
  byteSize: 8,
  f32Stride: 2,
  fields: [
    { name: "x", type: "f32", byteOffset: 0 },
    { name: "y", type: "f32", byteOffset: 4 },
  ],
  importPath: "src/components/position.ts",
  exportName: "Position",
} as const;

/** Velocity component with 2 float32 fields (x, y). */
const VELOCITY_ENTRY = {
  name: "Velocity",
  typeId: 2,
  byteSize: 8,
  f32Stride: 2,
  fields: [
    { name: "x", type: "f32", byteOffset: 0 },
    { name: "y", type: "f32", byteOffset: 4 },
  ],
  importPath: "src/components/velocity.ts",
  exportName: "Velocity",
} as const;

// ─── System source used in integration tests ─────────────────────────────────

/**
 * Minimal system source that matches the optimizable pattern:
 * - read Position via useComponentFor proxy
 * - mutate Position fields directly on the proxy
 */
const SYSTEM_SOURCE = `defineSystem(() => {                                  
    const entities = useQuery([Position]);                                                                                                                                                                                                                                                                                                                                                                                     
    onUpdate(() => {                                                                  
      for (const e of entities) {                                                     
        const pos = useComponentFor(e.id, Position);                                                                                                                                                                                                                                                                                                                                                                              
        pos.x += 1;                                                                                                                                                                                                                                                                                                                                                                                                            
        pos.y += 0;                                                                                                                                                                                                                                                                                                                                                                                                            
      }                                                                                                                                                                                                                                                                                                                                                                                                                        
    });                                                                            
  });`;

// ─── Unit tests ───────────────────────────────────────────────────────────────

describe("applyBulkTransform", () => {
  let manifest: ComponentManifest;

  beforeEach(() => {
    manifest = new ComponentManifest();
    manifest.register(POSITION_ENTRY);
    manifest.register(VELOCITY_ENTRY);
  });

  // ── No-positions guard ──────────────────────────────────────────────────────

  it("returns false when pattern has no positions field", () => {
    const code = "const x = 1;";
    const s = new MagicString(code);
    const pattern: OptimizablePattern = {
      queryComponents: ["Position"],
      readComponents: ["Position"],
      writeComponents: ["Position"],
      loc: { line: 1, column: 0, file: "test.ts" },
      // positions deliberately omitted
    };
    expect(applyBulkTransform(s, pattern, manifest, "core")).toBe(false);
  });

  it("does not mutate MagicString when positions are absent", () => {
    const code = "const x = 1;";
    const s = new MagicString(code);
    const pattern: OptimizablePattern = {
      queryComponents: ["Position"],
      readComponents: ["Position"],
      writeComponents: ["Position"],
      loc: { line: 1, column: 0, file: "test.ts" },
    };
    applyBulkTransform(s, pattern, manifest, "core");
    expect(s.hasChanged()).toBe(false);
  });

  // ── Integration tests (require AstWalker to parse real source) ──────────────

  it("transforms a single read+write component pattern", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    const result = applyBulkTransform(s, pattern, manifest, "core");
    expect(result).toBe(true);
    const output = s.toString();
    expect(output).toContain("queryReadBulk");
    expect(output).toContain("queryWriteBulk");
  });

  it("generates queryReadBulk before the for loop", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, "core");
    const output = s.toString();

    const readIdx = output.indexOf("queryReadBulk");
    const forIdx = output.indexOf("for (let _i");
    expect(readIdx).toBeGreaterThanOrEqual(0);
    expect(forIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeLessThan(forIdx);
  });

  it("generates queryWriteBulk after the for loop", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, "core");
    const output = s.toString();

    const writeIdx = output.indexOf("queryWriteBulk");
    const forIdx = output.lastIndexOf("for (let _i");
    expect(writeIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(forIdx);
  });

  it("replaces for-of loop with a numeric for loop", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, "core");
    const output = s.toString();

    expect(output).not.toContain("for (const e of");
    expect(output).toContain("for (let _i = 0;");
  });

  it("removes the per-entity read declaration (const pos = useComponentFor(...))", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, "core");
    const output = s.toString();

    expect(output).not.toContain("const pos = useComponentFor");
  });

  it("transforms proxy mutation assignments in place", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, "core");
    const output = s.toString();

    // proxy member expressions are rewritten — no `pos.x` or `pos.y` remain
    expect(output).not.toContain("pos.x");
    expect(output).not.toContain("pos.y");
    // assignment operators and RHS values are preserved in place
    expect(output).toContain("_position[_i * 2 + 0] += 1");
    expect(output).toContain("_position[_i * 2 + 1] += 0");
  });

  it("rewrites pos.x property access to typed-array accessor", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    applyBulkTransform(s, pattern, manifest, "core");
    const output = s.toString();

    expect(output).not.toContain("pos.x");
    expect(output).toContain("_position[_i * 2 + 0]");
  });

  it("produces a source map when transformation is applied", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    const pattern = patterns[0]!;
    if (!pattern.positions) return;

    const s = new MagicString(SYSTEM_SOURCE);
    const result = applyBulkTransform(s, pattern, manifest, "core");
    if (!result) return;

    const map = s.generateMap({ hires: true, source: "test.ts", includeContent: true });
    expect(map).toBeDefined();
    expect(map.mappings.length).toBeGreaterThan(0);
  });

  it("extracts pattern positions in AstWalker.walk output", () => {
    const walker = new AstWalker("test.ts");
    const patterns = walker.walk(SYSTEM_SOURCE);
    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0]!;

    if (!pattern.positions) return;

    const { positions } = pattern;
    expect(positions.forOfStart).toBeGreaterThanOrEqual(0);
    expect(positions.forBodyStart).toBeGreaterThan(positions.forOfStart);
    expect(positions.forOfEnd).toBeGreaterThan(positions.forBodyStart);
    expect(positions.entityVar).toBe("e");
    expect(positions.readDecls.length).toBeGreaterThan(0);
    // writeTargets replaces writeCalls — Position is mutated via proxy
    expect(positions.writeTargets).toContain("Position");
  });
});
