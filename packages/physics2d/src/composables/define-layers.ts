/**
 * @file defineLayers() — declares named physics layers with bitmask validation.
 */

/**
 * Declares named physics layers with their bitmask values.
 * The `gwen:physics2d` Vite plugin inlines layer values at build time.
 *
 * Emits a console warning if two layers share any bits.
 *
 * @param definition - Object mapping layer names to bitmask values.
 * @returns The same object with correct types (values are numbers).
 *
 * @example
 * ```typescript
 * export const Layers = defineLayers({
 *   player: 1 << 0,
 *   enemy:  1 << 1,
 *   wall:   1 << 2,
 * })
 * useStaticBody({ layer: Layers.wall, mask: Layers.player | Layers.enemy })
 * ```
 *
 * @since 1.0.0
 */
export function defineLayers<T extends Record<string, number>>(
  definition: T,
): { [K in keyof T]: number } {
  // Validate: no two layers share bits
  const values = Object.values(definition) as number[];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      if (values[i] & values[j]) {
        console.warn(
          `[gwen:physics2d] defineLayers: layers at index ${i} and ${j} share bits (${values[i]} & ${values[j]} = ${values[i] & values[j]}). This may cause unexpected collision filtering.`,
        );
      }
    }
  }
  return definition as { [K in keyof T]: number };
}
