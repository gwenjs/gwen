/**
 * Collision event parsing and Physics2D service API.
 */

import type { EntityId } from '@gwenjs/core';
import type { CollisionEvent, CollisionEventsBatch, SensorState } from './events';
import type { RigidBodyType, ColliderOptions } from './bodies';
import type { TilemapPhysicsChunk, ResolvedCollisionContact } from './tilemap';
import { PHYSICS2D_EVENTS_RING_FORMAT_VERSION } from './tilemap';

const EVENT_HEADER_BYTES = 8;
const EVENT_STRIDE = 19;
const LEGACY_EVENT_STRIDE = 11;
const COLLIDER_ID_ABSENT = 0xffffffff;

export function readCollisionEventsFromBuffer(bufOrView: ArrayBuffer | DataView): CollisionEvent[] {
  void PHYSICS2D_EVENTS_RING_FORMAT_VERSION;
  const view = bufOrView instanceof DataView ? bufOrView : new DataView(bufOrView);
  const writeHead = view.getUint32(0, true);
  const readHead = view.getUint32(4, true);
  const payloadBytes = view.byteLength - EVENT_HEADER_BYTES;
  const stride = payloadBytes % EVENT_STRIDE === 0 ? EVENT_STRIDE : LEGACY_EVENT_STRIDE;
  const capacity = Math.floor(payloadBytes / stride);

  if (capacity <= 0 || writeHead === readHead) return [];

  const events: CollisionEvent[] = [];
  let idx = readHead;

  while (idx !== writeHead) {
    const offset = EVENT_HEADER_BYTES + idx * stride;
    if (stride === EVENT_STRIDE) {
      const rawA = view.getUint32(offset + 10, true);
      const rawB = view.getUint32(offset + 14, true);
      const flags = view.getUint8(offset + 18);
      events.push({
        ...(rawA === COLLIDER_ID_ABSENT ? {} : { aColliderId: rawA }),
        ...(rawB === COLLIDER_ID_ABSENT ? {} : { bColliderId: rawB }),
        started: (flags & 1) === 1,
      });
    } else {
      const flags = view.getUint8(offset + 10);
      events.push({ started: (flags & 1) === 1 });
    }
    idx = (idx + 1) % capacity;
  }

  view.setUint32(4, writeHead, true);
  return events;
}

export interface Physics2DAPI {
  isDebugEnabled?(): boolean;
  addRigidBody(
    entityId: EntityId,
    type: RigidBodyType,
    x: number,
    y: number,
    opts?: {
      mass?: number;
      gravityScale?: number;
      linearDamping?: number;
      angularDamping?: number;
      initialVelocity?: { vx: number; vy: number };
      ccdEnabled?: boolean;
      additionalSolverIterations?: number;
    },
  ): number;
  addBoxCollider(bodyHandle: number, hw: number, hh: number, opts?: ColliderOptions): void;
  addBallCollider(bodyHandle: number, radius: number, opts?: ColliderOptions): void;
  removeBody(entityId: EntityId): void;
  setKinematicPosition(entityId: EntityId, x: number, y: number): void;
  /**
   * Teleport a 2D kinematic body to the given world-space position and angle.
   *
   * @param entityId - Packed entity id.
   * @param x - Target X position in metres.
   * @param y - Target Y position in metres.
   * @param angle - Target orientation in radians.
   * @returns `true` if the body was found.
   */
  setKinematicPositionWithAngle(entityId: EntityId, x: number, y: number, angle: number): boolean;
  /**
   * Integrate N kinematic body positions in one WASM call.
   *
   * Each body `i` is moved by `(vx[i], vy[i]) * dt`. Preserves current angle.
   *
   * @param slots - Uint32Array of entity slot indices.
   * @param vx - Float32Array of X velocity components in m/s.
   * @param vy - Float32Array of Y velocity components in m/s.
   * @param dt - Delta time in seconds.
   * @returns Number of bodies updated.
   */
  bulkStepKinematics(slots: Uint32Array, vx: Float32Array, vy: Float32Array, dt: number): number;
  applyImpulse(entityId: EntityId, x: number, y: number): void;
  setLinearVelocity(entityId: EntityId, vx: number, vy: number): void;
  getLinearVelocity(entityId: EntityId): { x: number; y: number } | null;
  getCollisionEventsBatch(opts?: { max?: number; coalesced?: boolean }): CollisionEventsBatch;
  getCollisionContacts(opts?: { max?: number }): ReadonlyArray<ResolvedCollisionContact>;
  getPosition(entityId: EntityId): { x: number; y: number; rotation: number } | null;
  getSensorState(entityId: EntityId, sensorId: number): SensorState;
  updateSensorState(entityId: EntityId, sensorId: number, started: boolean): void;
  buildNavmesh?(): void;
  findPath?(
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): Array<{ x: number; y: number }>;
  loadTilemapPhysicsChunk(
    chunk: TilemapPhysicsChunk,
    x: number,
    y: number,
    opts?: { debugNaive?: boolean },
  ): void;
  unloadTilemapPhysicsChunk(key: string): void;
  patchTilemapPhysicsChunk(
    chunk: TilemapPhysicsChunk,
    x: number,
    y: number,
    opts?: { debugNaive?: boolean },
  ): void;
}

export interface Physics2DWasmModule {
  Physics2DPlugin: new (
    gravityX: number,
    gravityY: number,
    transformBuf: Uint8Array,
    eventsBuf: Uint8Array,
    maxEntities: number,
  ) => WasmPhysics2DPlugin;
  default?: (init?: unknown) => Promise<void>;
}

export interface WasmPhysics2DPlugin {
  add_rigid_body(
    entityIndex: number,
    x: number,
    y: number,
    bodyType: number,
    mass: number,
    gravityScale: number,
    linearDamping: number,
    angularDamping: number,
    vx: number,
    vy: number,
    ccdEnabled?: number,
    additionalSolverIterations?: number,
  ): number;
  add_box_collider(
    bodyHandle: number,
    hw: number,
    hh: number,
    restitution: number,
    friction: number,
    isSensor: number,
    density: number,
    membership: number,
    filter: number,
    colliderId?: number,
    offsetX?: number,
    offsetY?: number,
  ): void;
  add_ball_collider(
    bodyHandle: number,
    radius: number,
    restitution: number,
    friction: number,
    isSensor: number,
    density: number,
    membership: number,
    filter: number,
    colliderId?: number,
    offsetX?: number,
    offsetY?: number,
  ): void;
  remove_rigid_body(entityIndex: number): void;
  set_kinematic_position(entityIndex: number, x: number, y: number): void;
  apply_impulse(entityIndex: number, x: number, y: number): void;
  set_linear_velocity(entityIndex: number, vx: number, vy: number): void;
  get_linear_velocity(entityIndex: number): number[];
  step(delta: number): void;
  get_position(entityIndex: number): number[];
  stats(): string;
  consume_event_metrics?(): number[];
  set_event_coalescing?(enabled: number): void;
  set_quality_preset?(preset: number): void;
  set_global_ccd_enabled?(enabled: number): void;
  bridge_schema_version?(): number;
  get_sensor_state?(entityIndex: number, sensorId: number): number[];
  update_sensor_state?(entityIndex: number, sensorId: number, started: number): void;
  load_tilemap_chunk_body?(
    chunkId: number,
    pseudoEntityIndex: number,
    x: number,
    y: number,
  ): number;
  unload_tilemap_chunk_body?(chunkId: number): void;
  free?(): void;
}
