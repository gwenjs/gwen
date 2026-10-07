/**
 * Reusable systems for the Physics3D plugin.
 *
 * These systems use `definePlugin` to expose simple stateful plugins
 * that can be composed into a game's plugin list.
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenEngine } from "@gwenjs/core";
import type { ComponentDef } from "@gwenjs/core/system";
import type { Physics3DAPI, Physics3DQuat, Physics3DVec3 } from "./types";
import "./augment";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Stable sensor id for the foot (ground-detection) sensor. */
export const SENSOR_ID_FOOT = 0xf007;

/** Stable sensor id for the head (ceiling-detection) sensor. */
export const SENSOR_ID_HEAD = 0xf008;

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Options for `createPhysicsKinematicSyncSystem`.
 */
export interface PhysicsKinematicSyncSystemOptions {
  /**
   * ECS component that holds `{ x, y, z }` transform data.
   * Pass the component definition. A string name is not accepted.
   */
  positionComponent: ComponentDef;
  /**
   * ECS component that holds `{ x, y, z, w }` rotation data.
   * Rotation sync is skipped when this is omitted.
   */
  rotationComponent?: ComponentDef;
}

function readVec3(value: unknown): Physics3DVec3 | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("x" in value) || !("y" in value) || !("z" in value)) return null;
  const { x, y, z } = value;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  return { x, y, z };
}

function readQuat(value: unknown): Physics3DQuat | null {
  const xyz = readVec3(value);
  if (xyz === null || typeof value !== "object" || value === null || !("w" in value)) return null;
  const { w } = value;
  if (typeof w !== "number") return null;
  return { x: xyz.x, y: xyz.y, z: xyz.z, w };
}

// ─── Systems ──────────────────────────────────────────────────────────────────

/**
 * Create a reusable plugin that syncs the ECS `Transform3D` component
 * into Rapier3D kinematic body positions each frame.
 *
 * Only entities that have both a registered kinematic body AND the configured
 * position component are affected.
 *
 * Register `Physics3DPlugin` first. `setup` resolves `physics3d` with
 * `engine.inject`, and Rapier applies a kinematic target on the next step.
 *
 * @param options - Position component, and an optional rotation component.
 * @returns A `definePlugin` class ready to be instantiated and registered.
 * @throws {GwenPluginNotFoundError} when `physics3d` is not registered.
 * `engine.use` reports that failure as `GwenComposableError` with code
 * `engine:plugin-setup-failed`.
 *
 * @example
 * ```ts
 * engine.use(createPhysicsKinematicSyncSystem({ positionComponent }));
 * ```
 */
export function createPhysicsKinematicSyncSystem(options: PhysicsKinematicSyncSystemOptions) {
  const positionComponent = options.positionComponent;
  const rotationComponent = options.rotationComponent;
  const queried = rotationComponent ? [positionComponent, rotationComponent] : [positionComponent];

  return definePlugin(() => {
    let physics: Physics3DAPI | null = null;
    let _engine: GwenEngine | null = null;
    let offBeforeUpdate: (() => void) | null = null;

    return {
      name: "Physics3DKinematicSyncSystem",

      setup(engine: GwenEngine): void {
        _engine = engine;
        physics = engine.inject("physics3d");
        offBeforeUpdate = engine.hooks.hook("engine:before-update", () => {
          if (!physics || !_engine) return;

          for (const entity of _engine.createLiveQuery(queried)) {
            // perf: replaced [...spread] with for...of to avoid array allocation every frame
            const entityId = entity.id;
            if (!physics.hasBody(entityId)) continue;
            if (physics.getBodyKind(entityId) !== "kinematic") continue;

            const pos = readVec3(entity.get(positionComponent));
            if (!pos) continue;

            const rot = rotationComponent
              ? (readQuat(entity.get(rotationComponent)) ?? undefined)
              : undefined;
            physics.setKinematicPosition(entityId, pos, rot);
          }
        });
      },

      teardown(): void {
        if (offBeforeUpdate) {
          offBeforeUpdate();
          offBeforeUpdate = null;
        }
        physics = null;
        _engine = null;
      },
    };
  });
}
