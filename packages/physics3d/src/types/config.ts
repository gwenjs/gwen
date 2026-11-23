import type { Vec3 } from "@gwenjs/math";
import type { PhysicsConfigBase, QualityPreset } from "@gwenjs/physics-core";

export type { QualityPreset };
export { QUALITY_PRESET_CODE } from "@gwenjs/physics-core";

/**
 * Configuration accepted by the Physics3D plugin constructor.
 * Gravity, layers, quality and the speed cap come from {@link PhysicsConfigBase}.
 * A missing component uses the default component (x 0, y -9.81, z 0) (`packages/physics3d/src/config.ts:21`).
 * Defaults: gravity `{ x: 0, y: -9.81, z: 0 }`, maxEntities `10_000`, qualityPreset `'medium'`, debug `false`, coalesceEvents `true`, maxLinearVelocity `400`.
 */
export interface Physics3DConfig extends PhysicsConfigBase<"3d"> {
  /**
   * Build-time Vite plugin options for `gwen:physics3d`.
   * These only affect the Vite build pipeline, not the runtime simulation.
   */
  vite?: {
    /**
     * Pre-bake BVH acceleration structures for `useMeshCollider('./file.glb')`
     * and `useConvexCollider('./file.glb')` patterns at build time.
     *
     * Requires the `physics3d/build-tools` Node.js WASM to be built first
     * (`pnpm run build:wasm` inside `packages/physics3d`).
     *
     * @default false
     */
    bvhPrebake?: boolean;
    /**
     * Log layer-inlining and BVH baking activity to the Vite console.
     * @default false
     */
    debug?: boolean;
  };
}

/** Normalized config. `gravity` may be partial. Read a component with `readGravityAxis` (`packages/physics3d/src/config.ts:21`). */
export interface ResolvedPhysics3DConfig {
  gravity: Partial<Vec3>;
  maxEntities: number;
  qualityPreset: QualityPreset;
  debug: boolean;
  coalesceEvents: boolean;
  /** Linear speed cap in m/s. A faster dynamic body is scaled and stays enabled. */
  maxLinearVelocity: number;
  layers: Record<string, number>;
}
