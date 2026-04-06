/**
 * @file BulkTransformer — Phase 2 code rewriter for the GWEN optimizer.
 *
 * Uses `MagicString` to perform position-based source mutations with source map
 * support, converting ergonomic per-entity ECS patterns into bulk WASM calls.
 *
 * Before (ergonomic):
 * ```ts
 * for (const e of entities) {
 *   const pos = useComponent(e, Position)
 *   useComponent(e, Position, { x: pos.x + 1, y: pos.y })
 * }
 * ```
 *
 * After (optimized):
 * ```ts
 * const { entityCount: _count_position, data: _position, slots: _slots, gens: _gens } =
 *   __gwen_bridge__.queryReadBulk([1], 1, 2);
 * for (let _i = 0; _i < _count_position; _i++) {
 *   // reads: _position[_i * 2 + 0]  (was pos.x)
 * }
 * __gwen_bridge__.queryWriteBulk(_slots, _gens, 1, _position);
 * ```
 */

import MagicString from 'magic-string';
import type { ComponentManifest } from './component-manifest.js';
import type { OptimizablePattern, WasmTier } from './types.js';
import { CodeGenerator } from './code-generator.js';

/**
 * Applies the Phase 2 bulk WASM transformation to a single `OptimizablePattern`
 * using `MagicString` for position-based source mutations with source map support.
 *
 * Algorithm (applied in reverse source order to avoid offset invalidation):
 *  1. Replace property accesses: `pos.x` → `_position[_i * 2 + 0]`
 *  2. Remove write call statements (replaced by bulk write after the loop)
 *  3. Remove read declaration statements (data is now in the typed array)
 *  4. Replace the for-of loop header with a numeric for loop
 *  5. After the for-of closing `}`, insert `queryWriteBulk` calls
 *  6. Before the for-of loop, insert all `queryReadBulk` declarations
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

  // Steps 2 & 3: Remove write-call and read-declaration statements.
  // Sort in reverse order so MagicString offset bookkeeping stays correct.
  const toRemove = [
    ...pos.writeCalls.map((w) => ({ start: w.start, end: w.end })),
    ...pos.readDecls.map((d) => ({ start: d.start, end: d.end })),
  ].sort((a, b) => b.start - a.start);
  for (const range of toRemove) {
    s.remove(range.start, range.end);
  }

  // Step 4: Replace `for (const e of entities)` header with `for (let _i = 0; _i < _count; _i++)`.
  // `forOfStart` → `forBodyStart` covers exactly the loop header (everything before `{`).
  const firstComp = pattern.readComponents[0] ?? pattern.writeComponents[0];
  if (!firstComp) return false;
  const countVar = `_count_${firstComp.toLowerCase()}`;
  s.overwrite(pos.forOfStart, pos.forBodyStart, `for (let _i = 0; _i < ${countVar}; _i++) `);

  // Step 5: Insert `queryWriteBulk` calls immediately after the closing `}` of the loop.
  const writeLines: string[] = [];
  for (const comp of pattern.writeComponents) {
    const dataVar = compToDataVar.get(comp)!;
    writeLines.push('\n    ' + gen.generateBulkWrite(comp, '_slots', '_gens', dataVar) + ';');
  }
  if (writeLines.length > 0) {
    s.appendLeft(pos.forOfEnd, writeLines.join(''));
  }

  // Step 6: Insert `queryReadBulk` declarations immediately before the for loop.
  // The first read component gets the full destructuring including entityCount/slots/gens.
  // Subsequent components only destructure the `data` buffer.
  const readLines: string[] = [];
  let isFirst = true;

  for (const comp of pattern.readComponents) {
    const entry = manifest.get(comp);
    if (!entry) continue;
    const dataVar = compToDataVar.get(comp)!;
    if (isFirst) {
      // Full destructuring: entityCount, data, slots, gens
      readLines.push(gen.generateBulkRead(pattern.queryComponents, comp) + ';');
      isFirst = false;
    } else {
      // Data-only destructuring for additional read components
      const typeIds = pattern.queryComponents.map((n) => manifest.get(n)!.typeId);
      readLines.push(
        `const { data: ${dataVar} } = __gwen_bridge__.queryReadBulk([${typeIds.join(', ')}], ${entry.typeId}, ${entry.f32Stride});`,
      );
    }
  }

  // Write-only components also need a queryReadBulk to obtain their data buffer and,
  // for the first component overall, the entityCount / slots / gens.
  for (const comp of pattern.writeComponents) {
    if (pattern.readComponents.includes(comp)) continue;
    const entry = manifest.get(comp);
    if (!entry) continue;
    const dataVar = compToDataVar.get(comp)!;
    const typeIds = pattern.queryComponents.map((n) => manifest.get(n)!.typeId);
    if (isFirst) {
      // First component overall — include entityCount, slots, gens
      readLines.push(
        `const { entityCount: ${countVar}, data: ${dataVar}, slots: _slots, gens: _gens } = __gwen_bridge__.queryReadBulk([${typeIds.join(', ')}], ${entry.typeId}, ${entry.f32Stride});`,
      );
      isFirst = false;
    } else {
      readLines.push(
        `const { data: ${dataVar} } = __gwen_bridge__.queryReadBulk([${typeIds.join(', ')}], ${entry.typeId}, ${entry.f32Stride});`,
      );
    }
  }

  if (readLines.length > 0) {
    s.prependLeft(pos.forOfStart, readLines.map((l) => '    ' + l).join('\n') + '\n    ');
  }

  return true;
}
