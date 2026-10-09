import type { ComponentManifest } from "./component-manifest";
import type { WasmTier } from "./types";
import { GwenError } from "@gwenjs/schema";

const OptimizerErrorCodes = {
  UNKNOWN_COMPONENT: "VITE:OPTIMIZER_UNKNOWN_COMPONENT",
  UNKNOWN_FIELD: "VITE:OPTIMIZER_UNKNOWN_FIELD",
} as const;

/**
 * Runtime component id for generated bulk calls.
 *
 * Baked numeric ids are disabled (#59). A cached per-engine lookup is #66.
 */
export function componentIdExpr(name: string): string {
  return `useEngine().getOrRegisterComponent(${JSON.stringify(name)})`;
}

/**
 * Generates TypeScript code snippets for bulk WASM operations.
 *
 * The generated code replaces the ergonomic `useComponent` per-entity
 * pattern with `WasmBridge.queryReadBulk` / `queryWriteBulk` calls that
 * cross the WASM boundary once per frame regardless of entity count.
 *
 * @example
 * Input pattern (ergonomic):
 * ```ts
 * for (const e of entities) {
 *   const pos = useComponentFor(e, Position)
 *   useComponentFor(e, Position, { x: pos.x + 1, y: pos.y })
 * }
 * ```
 *
 * Generated output (optimized):
 * ```ts
 * const { entityCount: _count_pos, data: _pos, slots: _slots, gens: _gens } =
 *   __gwen_bridge__.queryReadBulk([1, 2], 1, 2)
 * for (let i = 0; i < _count_pos; i++) {
 *   _pos[i * 2 + 0] = _pos[i * 2 + 0] + 1  // x
 * }
 * __gwen_bridge__.queryWriteBulk(_slots, _gens, 1, _pos)
 * ```
 */
export class CodeGenerator {
  constructor(
    private readonly manifest: ComponentManifest,
    private readonly tier: WasmTier,
  ) {}

  /**
   * Generate a `queryReadBulk` call that queries all `queryComponents` and
   * reads the `readComponent` data into a named Float32Array variable.
   *
   * @param queryComponents - All component type names entities must ALL have
   * @param readComponent   - Which component to bulk-read
   * @returns TypeScript source snippet (no trailing newline)
   * @throws {GwenError} if any component is not registered in the manifest
   */
  generateBulkRead(queryComponents: string[], readComponent: string): string {
    const entry = this.manifest.get(readComponent);
    if (!entry)
      throw new GwenError(
        OptimizerErrorCodes.UNKNOWN_COMPONENT,
        `[gwen:optimizer] Unknown component: ${readComponent}`,
      );

    const typeIds = queryComponents.map((name) => {
      const e = this.manifest.get(name);
      if (!e)
        throw new GwenError(
          OptimizerErrorCodes.UNKNOWN_COMPONENT,
          `[gwen:optimizer] Unknown component: ${name}`,
        );
      return componentIdExpr(name);
    });

    const varName = `_${readComponent.toLowerCase()}`;
    return [
      `const { entityCount: _count_${readComponent.toLowerCase()}, data: ${varName}, slots: _slots, gens: _gens } =`,
      `  __gwen_bridge__.queryReadBulk([${typeIds.join(", ")}], ${componentIdExpr(readComponent)}, ${entry.f32Stride})`,
    ].join("\n");
  }

  /**
   * Generate a `queryWriteBulk` call to write back updated component data.
   *
   * @param component  - Component name to write
   * @param slotsVar   - Variable name holding entity slot indices
   * @param gensVar    - Variable name holding entity generation counters
   * @param dataVar    - Variable name holding the Float32Array with updated data
   * @returns TypeScript source snippet
   * @throws {GwenError} if the component is not registered in the manifest
   */
  generateBulkWrite(component: string, slotsVar: string, gensVar: string, dataVar: string): string {
    const entry = this.manifest.get(component);
    if (!entry)
      throw new GwenError(
        OptimizerErrorCodes.UNKNOWN_COMPONENT,
        `[gwen:optimizer] Unknown component: ${component}`,
      );

    return `__gwen_bridge__.queryWriteBulk(${slotsVar}, ${gensVar}, ${componentIdExpr(component)}, ${dataVar})`;
  }

  /**
   * Generate an array index expression for accessing a specific field of a
   * component in a packed Float32Array.
   *
   * @param component - Component name
   * @param field     - Field name within the component
   * @param indexVar  - Loop variable name (e.g. `'i'`)
   * @param dataVar   - Float32Array variable name
   * @returns e.g. `"_pos[i * 2 + 0]"` for Position.x with f32Stride=2
   * @throws {GwenError} if the component or field is not registered in the manifest
   */
  generateFieldAccessor(
    component: string,
    field: string,
    indexVar: string,
    dataVar: string,
  ): string {
    const entry = this.manifest.get(component);
    if (!entry)
      throw new GwenError(
        OptimizerErrorCodes.UNKNOWN_COMPONENT,
        `[gwen:optimizer] Unknown component: ${component}`,
      );

    const fieldMeta = entry.fields.find((f) => f.name === field);
    if (!fieldMeta)
      throw new GwenError(
        OptimizerErrorCodes.UNKNOWN_FIELD,
        `[gwen:optimizer] Unknown field: ${component}.${field}`,
      );

    const fieldIndex = fieldMeta.byteOffset / 4;
    return `${dataVar}[${indexVar} * ${entry.f32Stride} + ${fieldIndex}]`;
  }
}
