/**
 * Shared material lookup. Dimension packages own the numbers.
 * An unknown name returns `undefined`. This module does not throw.
 */

/** Friction, restitution and density of one material. */
export interface MaterialValues {
  /** Coulomb friction. */
  friction: number;
  /** Bounce, from 0 to 1. */
  restitution: number;
  /** Mass per volume. */
  density: number;
}

/**
 * Own keys are the only names that resolve. Inherited keys are misses.
 * `Object.hasOwn` is ES2022. This package's lib is ES2020, so the check uses
 * `Object.prototype.hasOwnProperty.call`.
 */
export type MaterialTable = Readonly<Record<string, MaterialValues>>;

/** Preset names both dimension packages share. */
export const SHARED_MATERIAL_PRESETS: readonly ["default", "ice", "rubber"] = [
  "default",
  "ice",
  "rubber",
];

/** One name from {@link SHARED_MATERIAL_PRESETS}. */
export type SharedMaterialPreset = (typeof SHARED_MATERIAL_PRESETS)[number];

/**
 * Read `name` from `table`.
 * An absent name reads the own `default` row.
 * A name that is not an own key returns `undefined`.
 *
 * @param name - Preset name. `undefined` means the default row.
 * @param table - Own-key material rows.
 * @returns The row, or `undefined` when the name is not an own key.
 */
export function resolveMaterial(
  name: string | undefined,
  table: MaterialTable,
): MaterialValues | undefined;
export function resolveMaterial<K extends string>(
  name: string | undefined,
  table: Readonly<Record<K, MaterialValues>>,
): MaterialValues | undefined;
export function resolveMaterial(
  name: string | undefined,
  table: MaterialTable,
): MaterialValues | undefined {
  if (name === undefined) {
    if (!Object.prototype.hasOwnProperty.call(table, "default")) return undefined;
    return table.default;
  }
  if (!Object.prototype.hasOwnProperty.call(table, name)) return undefined;
  return table[name];
}
