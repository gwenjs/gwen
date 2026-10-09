/**
 * @file BulkTransformer — Phase 2 code rewriter for the GWEN optimizer.
 *
 * Uses `MagicString` to perform position-based source mutations with source map
 * support, converting ergonomic per-entity ECS patterns into bulk WASM calls.
 *
 * Before (ergonomic):
 * ```ts
 * for (const entity of entities) {
 *   const pos = useComponentFor(entity.id, Position)
 *   const vel = useComponentFor(entity.id, Velocity)
 *   pos.x += vel.x * dt
 *   pos.y += vel.y * dt
 * }
 * ```
 *
 * After (optimized):
 * ```ts
 * const { entityCount: _count_position, data: _position, slots: _slots, gens: _gens } =
 *   __gwen_bridge__.queryReadBulk([useEngine().getOrRegisterComponent("Position"), useEngine().getOrRegisterComponent("Velocity")], useEngine().getOrRegisterComponent("Position"), 2);
 * const { data: _velocity } =
 *   __gwen_bridge__.queryReadBulk([useEngine().getOrRegisterComponent("Position"), useEngine().getOrRegisterComponent("Velocity")], useEngine().getOrRegisterComponent("Velocity"), 2);
 * for (let _i = 0; _i < _count_position; _i++) {
 *   _position[_i * 2 + 0] += _velocity[_i * 2 + 0] * dt
 *   _position[_i * 2 + 1] += _velocity[_i * 2 + 1] * dt
 * }
 * __gwen_bridge__.queryWriteBulk(_slots, _gens, 1, _position);
 * ```
 */

import MagicString from "magic-string";
import type { ComponentManifest } from "./component-manifest.js";
import type { OptimizablePattern, WasmTier } from "./types.js";
import { CodeGenerator, componentIdExpr } from "./code-generator.js";

/**
 * Applies the Phase 2 bulk WASM transformation to a single `OptimizablePattern`
 * using `MagicString` for position-based source mutations with source map support.
 *
 * Algorithm (applied in reverse source order to avoid offset invalidation):
 *  1. Replace property accesses: `pos.x` → `_position[_i * 2 + 0]`
 *  2. Remove read declaration statements (data is now in the typed array)
 *  3. Replace the for-of loop header with a numeric for loop
 *  4. After the for-of closing `}`, insert `queryWriteBulk` calls
 *  5. Before the for-of loop, insert all `queryReadBulk` declarations
 *
 * Assignment statements (`pos.x += vel.x * dt`) are kept in place — only their
 * member expressions are rewritten. No statement-level removal is needed for writes.
 *
 * @param s        - MagicString wrapping the original source.
 * @param pattern  - Detected optimizable pattern with source positions.
 * @param manifest - Build-time component registry.
 * @param tier     - WASM tier for code generation.
 * @returns `true` if the transformation was applied, `false` if positions are missing.
 *
 * @example
 * ```ts
 * const s = new MagicString(source)
 * const applied = applyBulkTransform(s, pattern, manifest, 'core')
 * if (applied) return { code: s.toString(), map: s.generateMap({ hires: true }) }
 * ```
 */
export function applyBulkTransform(
  s: MagicString,
  pattern: OptimizablePattern,
  manifest: ComponentManifest,
  tier: WasmTier,
): boolean {
  const pos = pattern.positions;
  if (!pos) return false;

  const gen = new CodeGenerator(manifest, tier);

  // Component name → data variable: 'Position' → '_position'
  const compToDataVar = new Map<string, string>();
  for (const comp of [...pattern.readComponents, ...pattern.writeComponents]) {
    compToDataVar.set(comp, `_${comp.toLowerCase()}`);
  }

  // Read variable → component: 'pos' → 'Position'
  const varToComp = new Map<string, string>();
  for (const decl of pos.readDecls) {
    varToComp.set(decl.varName, decl.component);
  }

  // Step 1: Replace property accesses in reverse order to preserve byte offsets.
  // `pos.x` → `_position[_i * 2 + 0]`
  const sortedAccesses = [...pos.propAccesses].sort((a, b) => b.start - a.start);
  for (const acc of sortedAccesses) {
    const comp = varToComp.get(acc.varName);
    if (!comp) continue;
    const entry = manifest.get(comp);
    if (!entry) continue;
    const fieldMeta = entry.fields.find((f) => f.name === acc.fieldName);
    if (!fieldMeta) continue;
    const fieldIndex = fieldMeta.byteOffset / 4;
    const dataVar = compToDataVar.get(comp)!;
    s.overwrite(acc.start, acc.end, `${dataVar}[_i * ${entry.f32Stride} + ${fieldIndex}]`);
  }

  // Step 2: Remove read declaration statements in reverse order.
  // Assignment statements (proxy mutations) are intentionally left in place —
  // their member expressions were already rewritten in Step 1.
  const sortedDecls = [...pos.readDecls].sort((a, b) => b.start - a.start);
  for (const decl of sortedDecls) {
    s.remove(decl.start, decl.end);
  }

  // Step 3: Replace `for (const e of entities)` header with a numeric for loop.
  // `forOfStart` → `forBodyStart` covers exactly the loop header (everything before `{`).
  const firstComp = pattern.readComponents[0] ?? pattern.writeComponents[0];
  if (!firstComp) return false;
  const countVar = `_count_${firstComp.toLowerCase()}`;
  s.overwrite(pos.forOfStart, pos.forBodyStart, `for (let _i = 0; _i < ${countVar}; _i++) `);

  // Step 4: Insert `queryWriteBulk` calls immediately after the closing `}` of the loop.
  const writeLines: string[] = [];
  for (const comp of pos.writeTargets) {
    const dataVar = compToDataVar.get(comp)!;
    writeLines.push("\n    " + gen.generateBulkWrite(comp, "_slots", "_gens", dataVar) + ";");
  }
  if (writeLines.length > 0) {
    s.appendLeft(pos.forOfEnd, writeLines.join(""));
  }

  // Step 5: Insert `queryReadBulk` declarations immediately before the for loop.
  // The first read component gets the full destructuring including entityCount/slots/gens.
  // Subsequent components only destructure the `data` buffer.
  const readLines: string[] = [];
  let isFirst = true;

  for (const comp of pattern.readComponents) {
    const entry = manifest.get(comp);
    if (!entry) continue;
    const dataVar = compToDataVar.get(comp)!;
    if (isFirst) {
      readLines.push(gen.generateBulkRead(pattern.queryComponents, comp) + ";");
      isFirst = false;
    } else {
      const typeIds = pattern.queryComponents.map((n) => componentIdExpr(n));
      readLines.push(
        `const { data: ${dataVar} } = __gwen_bridge__.queryReadBulk([${typeIds.join(", ")}], ${componentIdExpr(comp)}, ${entry.f32Stride});`,
      );
    }
  }

  // Write-only components (not in readComponents) also need a queryReadBulk
  // to obtain their data buffer and, for the very first component, entityCount/slots/gens.
  for (const comp of pos.writeTargets) {
    if (pattern.readComponents.includes(comp)) continue;
    const entry = manifest.get(comp);
    if (!entry) continue;
    const dataVar = compToDataVar.get(comp)!;
    const typeIds = pattern.queryComponents.map((n) => componentIdExpr(n));
    if (isFirst) {
      readLines.push(
        `const { entityCount: ${countVar}, data: ${dataVar}, slots: _slots, gens: _gens } = __gwen_bridge__.queryReadBulk([${typeIds.join(", ")}], ${componentIdExpr(comp)}, ${entry.f32Stride});`,
      );
      isFirst = false;
    } else {
      readLines.push(
        `const { data: ${dataVar} } = __gwen_bridge__.queryReadBulk([${typeIds.join(", ")}], ${componentIdExpr(comp)}, ${entry.f32Stride});`,
      );
    }
  }

  if (readLines.length > 0) {
    s.prependLeft(pos.forOfStart, readLines.map((l) => "    " + l).join("\n") + "\n    ");
  }

  return true;
}
