/**
 * Reusable systems for the Physics3D plugin.
 *
 * These systems use `definePlugin` to expose simple stateful plugins
 * that can be composed into a game's plugin list.
 */

import { definePlugin } from "@gwenjs/kit/plugin";
import type { EntityId, GwenEngine } from "@gwenjs/core";
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
   * ECS component name that holds `{ x, y, z }` transform data.
   * @default 'transform3d'
   */
  positionComponent?: string;
  /**
   * ECS component name that holds `{ x, y, z, w }` rotation data.
   * Rotation sync is skipped when this is `undefined`.
   * @default undefined
   */
  rotationComponent?: string;
}

// ─── Internal type helpers ─────────────────────────────────────────────────────

/**
 * Internal interface for string-named component and query access.
 *
 * The public `GwenEngine` API accepts typed `ComponentDefinition` descriptors.
 * However, this kinematic sync system is intentionally generic — it operates on
 * component names supplied as configuration strings, which the runtime engine
 * supports but the TypeScript interface does not expose.
 *
 * @internal Do not use this type outside of this module.
 */
interface StringQueryEntity {
  readonly id: EntityId;
  get(name: string): unknown;
}

interface GwenEngineStringComponentAccess {
  /**
   * Look up entities that have a component identified by the given string name.
   * The runtime yields accessors, not bare entity ids.
   */
  createLiveQuery(names: string[]): Iterable<StringQueryEntity>;
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
 * @param options - Optional component names and conversion settings.
 * @returns A `definePlugin` class ready to be instantiated and registered.
 *
 * @example
 * ```ts
 * engine.use(createPhysicsKinematicSyncSystem());
 * ```
 */
export function createPhysicsKinematicSyncSystem(options: PhysicsKinematicSyncSystemOptions = {}) {
  const positionComponent = options.positionComponent ?? "transform3d";
  const rotationComponent = options.rotationComponent;

  return definePlugin(() => {
    let physics: Physics3DAPI | null = null;
    let _engine: GwenEngine | null = null;
    let offBeforeUpdate: (() => void) | null = null;

    return {
      name: "Physics3DKinematicSyncSystem",

      setup(engine: GwenEngine): void {
        _engine = engine;
        physics = engine.tryInject("physics3d") ?? null;
        offBeforeUpdate = engine.hooks.hook("engine:before-update", () => {
          if (!physics || !_engine) return;

          // Access the runtime string-based query/component API.
          // The GwenEngine public type accepts ComponentDefinition descriptors;
          // the underlying runtime also accepts component name strings, which
          // this generic sync system relies on.
          const stringEngine = _engine as unknown as GwenEngineStringComponentAccess;

          for (const entity of stringEngine.createLiveQuery([positionComponent])) {
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
