/**
 * Types for the GWEN 3D physics plugin.
 * All types are pure data — no WASM dependency.
 *
 * This is a barrel module that re-exports types from organized sub-modules:
 * - `./types/config` - Primitive types, config, and quality presets
 * - `./types/bodies` - Body-related types, handles, and DX composable types
 * - `./types/colliders` - Collider shapes, materials, and handles
 * - `./types/bulk` - Bulk operation types
 * - `./types/events` - Collision and sensor event types, hooks, and prefab extensions
 * - `./types/joints` - Joint, query, pathfinding, and character controller types (RFC-07/08/09)
 * - `./types/api` - The Physics3DAPI service interface
 */

export * from './types/config';
export * from './types/bodies';
export * from './types/colliders';
export * from './types/bulk';
export * from './types/events';
export * from './types/joints';
export * from './types/api';
