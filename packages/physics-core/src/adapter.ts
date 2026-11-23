/**
 * Backend contract a dimension package implements for {@link createPhysicsPlugin}.
 */

import type { EntityId, GwenPrefabExtensions } from "@gwenjs/schema";
import type { CollisionEventLayout } from "./events.js";
import type { CollisionContact, Dim } from "./types.js";

/**
 * One dimension's physics backend.
 *
 * The shared plugin owns the engine hooks. The adapter owns the simulation.
 *
 * @typeParam D - Physics dimension.
 * @typeParam Api - Value stored with `engine.provide` under the plugin's service key.
 */
export interface PhysicsAdapter<D extends Dim, Api> {
  /** Dimension this adapter simulates. */
  readonly dim: D;

  /** Value stored under the plugin's service key. */
  readonly api: Api;

  /** Byte layout of the buffer `eventView` returns. */
  readonly eventLayout: CollisionEventLayout;

  /**
   * Advance the simulation by `dt` seconds.
   * The plugin calls this only when `dt > 0`.
   *
   * @param dt - Frame delta in seconds. Greater than 0.
   */
  step(dt: number): void;

  /**
   * Packed events from the last `step`.
   *
   * @returns The buffer and its event count, or `undefined` when this frame has no buffer.
   */
  eventView(): { readonly view: DataView; readonly count: number } | undefined;

  /**
   * Entity that owns a body slot.
   *
   * @param slot - Body slot in the event buffer.
   * @returns The entity, or `undefined` when the slot has no owner.
   */
  resolveEntity(slot: number): EntityId | undefined;

  /**
   * Sensor id for one collider, or `undefined` when that collider is not a sensor.
   *
   * @param slot - Body slot that owns the collider.
   * @param reportedId - Collider id from the event, or `undefined` when the event left it out.
   * @returns The sensor id the shared tracker should use, or `undefined` to ignore the collider.
   */
  resolveSensorId(slot: number, reportedId: number | undefined): number | undefined;

  /**
   * A prefab was instantiated. The adapter reads its own key from `extensions`.
   *
   * @param entityId - Entity the prefab wrote.
   * @param extensions - Prefab extension bag.
   */
  onPrefab?(entityId: EntityId, extensions: Readonly<Partial<GwenPrefabExtensions>>): void;

  /**
   * An entity was destroyed.
   *
   * @param entityId - Entity that is gone.
   */
  onEntityDestroy(entityId: EntityId): void;

  /** Release backend resources. The plugin calls this once from `teardown`. */
  dispose(): void;

  /**
   * Start of an `engine:before-update`.
   * The plugin calls this on every frame, before it decides whether to `step`.
   *
   * @param dt - Frame delta in seconds. It may be 0, negative or NaN.
   */
  beginFrame?(dt: number): void;

  /**
   * Contacts of one frame. The plugin passes the array it decoded.
   *
   * @param contacts - Contacts from this frame. Empty when the frame had none.
   */
  onContacts?(contacts: ReadonlyArray<CollisionContact>): void;
}
