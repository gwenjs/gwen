/**
 * @file Dependency range of the linked framework group.
 *
 * A plugin declares its `@gwenjs/*` peers on {@link CORE_RANGE}.
 * The range does not satisfy `0.2.x`. It matches stack-harness stamps
 * `1.0.0-integration.<UTC yyyymmddHHMMSS>.g<sha7>`.
 *
 * @module
 */

/**
 * Dependency range shared by core, kit, physics2d, physics3d, renderer-core,
 * and camera-core. physics-core joins once #58 P-58-0 ships.
 */
export const CORE_RANGE = "^1.0.0-alpha.0" as const;
