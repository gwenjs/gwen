import type { GwenEngine, EntityId, ComponentDef, LiveQuery, EntityAccessor } from '@gwenjs/core';
import type { Physics2DAPI, SensorState } from './types';
import type {} from './augment';

/** Default pixel-to-meter conversion ratio for Rapier2D. */
const DEFAULT_PIXELS_PER_METER = 50;
/** Default ECS component name used to read 2D positions. */
const DEFAULT_POSITION_COMPONENT = 'position';

/**
 * A minimal 2D vector with `x` and `y` numeric coordinates.
 * Used when reading position data from the ECS component store.
 */
interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Narrows an `unknown` value to {@link Vec2}.
 *
 * @param v - The value to test.
 * @returns `true` when `v` is a non-null object that has numeric `x` and `y` fields.
 * @internal
 */
function isVec2(v: unknown): v is Vec2 {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>)['x'] === 'number' &&
    typeof (v as Record<string, unknown>)['y'] === 'number'
  );
}

/**
 * Configuration options for {@link createPhysicsKinematicSyncSystem}.
 */
export interface PhysicsKinematicSyncSystemOptions {
  /**
   * Conversion ratio from pixels (ECS units) to meters (Rapier2D).
   * @default 50
   */
  pixelsPerMeter?: number;
  /**
   * ECS component name whose data contains `{ x: number; y: number }` coordinates.
   * @default 'position'
   */
  positionComponent?: string;
}

/**
 * Creates a reusable plugin that syncs ECS 2D positions into Rapier kinematic bodies
 * every frame via a live entity query.
 *
 * The plugin subscribes to the ECS world via `engine.createLiveQuery` during `setup`,
 * so only entities that carry the configured position component are ever visited —
 * O(matched) instead of O(all entities).
 *
 * Body and collider lifecycle is managed separately by the prefab
 * `extensions.physics` block inside the `Physics2DPlugin`.
 *
 * @param options - Optional pixel-to-meter ratio and position component name.
 * @returns A plugin object ready to register with `engine.use()`.
 *
 * @example
 * ```typescript
 * import { createPhysicsKinematicSyncSystem } from '@gwenjs/physics2d'
 *
 * engine.use(
 *   createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50, positionComponent: 'position' })
 * )
 * ```
 *
 * @since 1.0.0
 */
export function createPhysicsKinematicSyncSystem(options: PhysicsKinematicSyncSystemOptions = {}) {
  const _pixelsPerMeter = options.pixelsPerMeter ?? DEFAULT_PIXELS_PER_METER;
  const _positionComponent = options.positionComponent ?? DEFAULT_POSITION_COMPONENT;

  let _physics: Physics2DAPI | null = null;
  let _liveQuery: LiveQuery<EntityAccessor> | null = null;

  return {
    /** Unique plugin identifier consumed by the engine registry. */
    name: 'PhysicsKinematicSyncSystem',

    /**
     * Initialises the plugin: resolves the Physics2D service and registers a
     * live query so only matching entities are visited each frame.
     *
     * @param engine - The running GWEN engine instance.
     */
    setup(engine: GwenEngine): void {
      _physics = engine.inject('physics2d');

      // The ECS registry accepts string component names at runtime even though the
      // TypeScript overload expects a ComponentDefinition. The cast avoids `any`.
      _liveQuery = engine.createLiveQuery([_positionComponent as unknown as ComponentDef]);
    },

    /**
     * Runs before the physics step each frame.
     * Iterates the live query and pushes each entity's pixel-space position into
     * the Rapier kinematic body as meter-space coordinates.
     *
     * @param _dt - Delta time in seconds (unused here; provided for interface compatibility).
     */
    onBeforeUpdate(_dt: number): void {
      if (!_physics || !_liveQuery) return;

      for (const entity of _liveQuery) {
        // The ECS registry accepts string names at runtime; cast satisfies TypeScript.
        const rawPos: unknown = entity.get(_positionComponent as unknown as ComponentDef);
        if (!isVec2(rawPos)) continue;

        _physics.setKinematicPosition(
          entity.id,
          rawPos.x / _pixelsPerMeter,
          rawPos.y / _pixelsPerMeter,
        );
      }
    },

    /**
     * Releases all references held by this plugin.
     * Must be called when the plugin is removed from the engine.
     */
    teardown(): void {
      _physics = null;
      _liveQuery = null;
    },
  };
}

// ─── Platformer grounded helper ──────────────────────────────────────────────

/**
 * Opaque sensor identifier for the foot sensor in platformer games.
 *
 * Collider IDs in this range (`0xf000`–`0xf0ff`) are reserved for
 * GWEN built-in sensor helpers.
 *
 * @since 1.0.0
 */
export const SENSOR_ID_FOOT = 0xf007;

/**
 * Configuration options for {@link createPlatformerGroundedSystem}.
 *
 * @since 1.0.0
 */
export interface PlatformerGroundedSystemOptions {
  /**
   * Sensor collider ID used to detect ground contacts.
   * @default SENSOR_ID_FOOT (0xf007)
   */
  sensorId?: number;
}

/**
 * Creates a tree-shakable helper that derives `isGrounded` and `getSensorState`
 * from a foot-sensor collider registered on the entity's rigid body.
 *
 * This helper is intentionally **not** a full plugin — it is a thin wrapper over
 * the Physics2D sensor API designed to be composed inside your own game system.
 *
 * @param options - Physics API reference and optional sensor ID override.
 * @returns An object with `isGrounded(entityId)` and `getSensorState(entityId)`.
 *
 * @example
 * ```typescript
 * import { createPlatformerGroundedSystem } from '@gwenjs/physics2d'
 * import { defineSystem, onUpdate } from '@gwenjs/core'
 * import { usePhysics2D } from '@gwenjs/physics2d'
 *
 * export const playerSystem = defineSystem(() => {
 *   const physics = usePhysics2D()
 *   const grounded = createPlatformerGroundedSystem({ physics })
 *
 *   onUpdate(() => {
 *     if (grounded.isGrounded(playerId)) {
 *       // allow jump
 *     }
 *   })
 * })
 * ```
 *
 * @since 1.0.0
 */
export function createPlatformerGroundedSystem(
  options: PlatformerGroundedSystemOptions & { physics: Physics2DAPI },
) {
  const { physics } = options;
  const sensorId = options.sensorId ?? SENSOR_ID_FOOT;

  return {
    /**
     * Returns `true` if the entity's foot sensor is currently touching ground.
     *
     * @param entityId - The entity whose foot sensor to check.
     * @returns `true` when at least one contact is active on the foot sensor.
     */
    isGrounded(entityId: EntityId): boolean {
      return physics.getSensorState(entityId, sensorId).isActive;
    },

    /**
     * Returns the full sensor state for the entity's foot sensor.
     *
     * @param entityId - The entity whose foot sensor state to read.
     * @returns A {@link SensorState} snapshot for the configured foot sensor.
     */
    getSensorState(entityId: EntityId): SensorState {
      return physics.getSensorState(entityId, sensorId);
    },
  };
}
