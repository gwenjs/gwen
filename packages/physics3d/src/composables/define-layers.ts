/**
 * @file defineLayers() — define collision layer bitmasks for a physics world.
 */

/**
 * Define a set of named collision layer bitmasks.
 *
 * Each value should be a power-of-two bitmask (1, 2, 4, 8, …) so that layers
 * can be combined with bitwise OR and filtered with bitwise AND. If any two
 * entries share overlapping bits, a console warning is emitted.
 *
 * The object is passed through as-is (same reference, same values), making the
 * return type identical to the input. The main purpose of this function is:
 * 1. Provide a named declaration point for IDE autocompletion.
 * 2. Validate bit-overlap at runtime to catch misconfiguration early.
 * 3. Enable the `gwen:physics3d` Vite plugin to inline the constants at build time
 *    for dead-code elimination.
 *
 * @param definition - Map of layer names to their bitmask values.
 * @returns The same map, typed as `{ [K in keyof T]: number }`.
 *
 * @example
 * ```typescript
 * const Layers = defineLayers({
 *   player:  0b0001,  // 1
 *   enemy:   0b0010,  // 2
 *   ground:  0b0100,  // 4
 *   trigger: 0b1000,  // 8
 * })
 *
 * useDynamicBody({ layer: Layers.player, mask: Layers.ground | Layers.enemy })
 * ```
 *
 * @since 1.0.0
 */
export function defineLayers<T extends Record<string, number>>(
  definition: T,
): { [K in keyof T]: number } {
  const entries = Object.entries(definition);
  const values = entries.map(([, v]) => v);

  // Validate that no two layer values share bits
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const shared = values[i] & values[j];
      if (shared) {
        console.warn(
          `[gwen:physics3d] defineLayers: layers share bits (${values[i]} & ${values[j]} = ${shared}). ` +
            `This may cause unexpected collision filtering.`,
        );
      }
    }
  }

  return { ...definition } as { [K in keyof T]: number };
}
