import { definePlugin } from '@gwenjs/kit';
import { getWasmBridge, createEntityId, unpackEntityId } from '@gwenjs/core';
import type { EntityId, GwenEngine } from '@gwenjs/core';

import type {
  Physics3DAPI,
  Physics3DBodyHandle,
  Physics3DBodyOptions,
  Physics3DBodyState,
  Physics3DConfig,
  Physics3DEntityId,
  Physics3DColliderOptions,
  Physics3DCollisionContact,
  Physics3DSensorState,
  Physics3DPrefabExtension,
  CompoundShapeSpec,
  BulkStaticBoxesOptions,
  BulkStaticBoxesResult,
  Physics3DVec3,
  Physics3DQuat,
  Physics3DColliderShape,
  FixedJointOpts,
  RevoluteJointOpts,
  PrismaticJointOpts,
  BallJointOpts,
  SpringJointOpts,
  JointHandle3D,
  JointId,
  RayHit,
  ShapeHit,
  PointProjection,
  Pathfinding3DOptions,
  PathWaypoint3D,
  CharacterControllerOpts,
  CharacterControllerHandle,
  RaycastOpts,
  RaycastHandle,
  RaycastSlotResult,
  ShapeCastOpts,
  ShapeCastHandle,
  ShapeCastSlotResult,
  OverlapOpts,
  OverlapHandle,
  OverlapSlotResult,
} from '../types';

import {
  normalizePhysics3DConfig,
  buildLayerRegistry,
  resolveLayerBits,
  QUALITY_PRESETS,
} from '../config';

import { _dispatchContactEvent, _clearContactCallbacks } from '../composables/on-contact';
import {
  _dispatchSensorEnter,
  _dispatchSensorExit,
  _clearSensorCallbacks,
} from '../composables/on-sensor';
import { encodeCompoundShapes } from '../helpers/compound';
import { nextColliderId } from '../composables/collider-id';

import { EVENT_STRIDE_3D, MAX_EVENTS_3D, COLLIDER_ID_ABSENT } from './constants';
import type {
  InternalCollisionEvent3D,
  Physics3DWasmBridge,
  Physics3DBridgeRuntime,
} from './bridge';
import {
  _fetchBvhBuffer,
  _clearBvhCache,
  getBvhWorker,
  BVH_WORKER_THRESHOLD,
  _bvhWorkerCallbacks,
  getNextBvhJobId,
  registerBvhCallback,
} from './bvh';

import {
  vec3,
  quat,
  toEntityIndex,
  kindFromU8,
  kindToU8,
  parseBodyState,
  cloneState,
  resolveColliderMaterial,
  computeColliderAABB,
  aabbOverlap,
} from './physics3d-utils';

// ─── MinHeap ───────────────────────────────────────────────────────────────────

/**
 * A generic binary min-heap for A* open sets.
 *
 * push and pop are both O(log n).
 *
 * @typeParam T - The value type stored alongside each priority.
 * @example
 * ```typescript
 * const heap = new MinHeap<string>();
 * heap.push('b', 10);
 * heap.push('a', 5);
 * heap.pop(); // 'a'
 * ```
 */
class MinHeap<T> {
  private readonly _data: Array<{ priority: number; value: T }> = [];

  /** Number of elements in the heap. */
  get size(): number {
    return this._data.length;
  }

  /**
   * Insert `value` with the given `priority`. O(log n).
   * @param value    - The value to store.
   * @param priority - Lower values are popped first.
   */
  push(value: T, priority: number): void {
    this._data.push({ priority, value });
    this._bubbleUp(this._data.length - 1);
  }

  /**
   * Remove and return the minimum-priority value. O(log n).
   * Returns `undefined` if the heap is empty.
   */
  pop(): T | undefined {
    if (this._data.length === 0) return undefined;
    const top = this._data[0]!.value;
    const last = this._data.pop();
    if (last !== undefined && this._data.length > 0) {
      this._data[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    const data = this._data;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (data[parent]!.priority <= data[i]!.priority) break;
      [data[parent], data[i]] = [data[i]!, data[parent]!];
      i = parent;
    }
  }

  private _siftDown(i: number): void {
    const data = this._data;
    const n = data.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && data[l]!.priority < data[min]!.priority) min = l;
      if (r < n && data[r]!.priority < data[min]!.priority) min = r;
      if (min === i) break;
      [data[i], data[min]] = [data[min]!, data[i]!];
      i = min;
    }
  }
}

// ─── Plugin implementation ──────────────────────────────────────────────────────

/**
 * GWEN plugin providing 3D rigid-body physics via Rapier3D integrated in the
 * core WASM. Falls back to a deterministic TypeScript simulation when the WASM
 * physics3d variant is not loaded (e.g. during tests).
 */
export const Physics3DPlugin = definePlugin((config: Physics3DConfig = {}) => {
  const cfg = normalizePhysics3DConfig(config);

  // Layer registry built from config
  const layerRegistry = buildLayerRegistry(cfg.layers);

  // Plugin state
  let ready = false;
  let _variant: 'light' | 'physics2d' | 'physics3d' = 'light';
  let stepFn: ((delta: number) => void) | null = null;
  let offEntityDestroyed: (() => void) | null = null;
  let nextBodyId = 1;
  /** 'wasm' when Rapier3D body APIs are available; 'local' otherwise. */
  let backendMode: 'wasm' | 'local' = 'local';
  /** Cached WASM bridge — non-null only in 'wasm' mode. */
  let wasmBridge: Physics3DWasmBridge | null = null;
  /** Bridge runtime for memory access. */
  let bridgeRuntime: Physics3DBridgeRuntime | null = null;
  /** Stored GwenEngine reference — set in setup(), used by lifecycle hooks. */
  let _engine: GwenEngine | null = null;

  // Body registry — used in both modes as the metadata store
  const bodyByEntity = new Map<number, Physics3DBodyHandle>();

  // Local simulation state (used only in 'local' mode)
  const stateByEntity = new Map<number, Physics3DBodyState>();

  // Collider registry — used in both modes
  const localColliders = new Map<number, Physics3DColliderOptions[]>();

  // Pending async BVH loads: colliderId → { AbortController, ready Promise }
  const _pendingBvhLoads = new Map<number, { ac: AbortController; ready: Promise<void> }>();

  // Sensor state — outer key = entity slot index, inner key = sensorId
  const localSensorStates = new Map<number, Map<number, Physics3DSensorState>>();

  // Per-entity collision callbacks
  const entityCollisionCallbacks = new Map<
    number,
    NonNullable<Physics3DPrefabExtension['onCollision']>
  >();

  // Current frame contacts (rebuilt each frame in onUpdate)
  let currentFrameContacts: Physics3DCollisionContact[] = [];

  // Track overlapping AABB pairs from the previous frame (local mode only).
  // Key format: `${slotA}:${colliderIdA ?? -1}:${slotB}:${colliderIdB ?? -1}`
  let previousLocalContactKeys = new Set<string>();

  // WASM event buffer state
  let eventsView: DataView | null = null;
  let eventsBufferRef: ArrayBuffer | null = null;

  // Pooled internal event array — reused every frame to avoid GC pressure
  const pooledEvents: InternalCollisionEvent3D[] = [];

  // Event metrics for the last processed frame
  let lastFrameEventCount = 0;

  // ─── Utility helpers ─────────────────────────────────────────────────────────

  /** Generate the next stable collider id for an entity. */
  const nextColliderIdForEntity = (entityId: Physics3DEntityId): number => {
    const slot = toEntityIndex(entityId);
    const existing = localColliders.get(slot);
    return existing ? existing.length : 0;
  };

  // ─── RFC-08/09/10: Additional local state ────────────────────────────────────

  /** Per-entity accumulated forces (local mode only). */
  const localForces = new Map<number, { x: number; y: number; z: number }>();

  /** Per-entity accumulated torques (local mode only). */
  const localTorques = new Map<number, { x: number; y: number; z: number }>();

  /** Per-entity axis-lock state (local mode only). */
  const localAxisLocks = new Map<
    number,
    { tx: boolean; ty: boolean; tz: boolean; rx: boolean; ry: boolean; rz: boolean }
  >();

  /** Set of entity slot indices that are sleeping (local mode only). */
  const localSleeping = new Set<number>();

  /** Per-entity gravity scale overrides (local mode only). */
  const localGravityScales = new Map<number, number>();

  /** Character controller registrations — slot index → { slotIndex, entityIndex }. */
  const ccRegistrations = new Map<number, { slotIndex: number; entityIndex: number }>();

  /**
   * Wrapper object for the SAB-backed Float32Array view used to read CC state
   * (isGrounded, groundNormal). The `.view` property is mutated when the SAB
   * is (re-)allocated, so closures capture the wrapper rather than the array.
   */
  const ccSABView: { view: Float32Array | null } = { view: null };

  /**
   * Wrapper object for the descriptor Float32Array used to write per-frame CC
   * move commands. The `.view` property is mutated on (re-)allocation.
   */
  const ccDescriptorBuffer: { view: Float32Array | null } = { view: null };

  /** Suppresses the local-mode CC warning after the first emission. */
  let _emittedCCLocalWarning = false;

  // ─── Raycast slots ────────────────────────────────────────────────────────────

  /** Maximum number of persistent raycast slots. */
  const MAX_RAYCAST_SLOTS = 64;

  /** f32 fields per CC slot in the WASM CC state buffer. */
  const CC_STATE_STRIDE = 5 as const;

  /** Counter used to assign unique ids to raycast slots. */
  let nextRaycastSlotId = 0;

  /** Registered raycast slots: id → { opts, result, _si }. */
  const raycastSlots = new Map<
    number,
    { opts: RaycastOpts; result: RaycastSlotResult; _si: Float32Array }
  >();

  /** WASM linear-memory pointer to the raycast SAB output region. */
  const _raycastOutputSABPtr = 0;

  // ─── Shape-cast slots ─────────────────────────────────────────────────────────

  /** Maximum number of persistent shape-cast slots. */
  const MAX_SHAPECAST_SLOTS = 64;

  /** Counter used to assign unique ids to shape-cast slots. */
  let nextShapeCastSlotId = 0;

  /** Registered shape-cast slots: id → { opts, result, _si }. */
  const shapeCastSlots = new Map<
    number,
    { opts: ShapeCastOpts; result: ShapeCastSlotResult; _si: Float32Array }
  >();

  /** WASM linear-memory pointer to the shape-cast SAB output region. */
  const _shapecastOutputSABPtr = 0;

  // ─── Overlap slots ────────────────────────────────────────────────────────────

  /** Maximum number of persistent overlap slots. */
  const MAX_OVERLAP_SLOTS = 64;

  /** Maximum number of results per composable overlap query. */
  const MAX_COMPOSABLE_OVERLAP_RESULTS = 16;

  /** Counter used to assign unique ids to overlap slots. */
  let nextOverlapSlotId = 0;

  /** Registered overlap slots: id → { opts, result, _si }. */
  const overlapSlots = new Map<
    number,
    { opts: OverlapOpts; result: OverlapSlotResult; _si: Float32Array }
  >();

  /** WASM linear-memory pointer to the overlap SAB output region. */
  const _overlapOutputSABPtr = 0;

  /** DataView over the single-query overlap scratch buffer (WASM mode). */
  const overlapScratchView: DataView | null = null;

  /** WASM linear-memory pointer to the single-query overlap scratch buffer. */
  const overlapScratchPtr = 0;

  // ─── Pathfinding ──────────────────────────────────────────────────────────────

  /** Navigation grid stored for local-mode A* use. */
  let _localNavGrid: Pathfinding3DOptions | null = null;

  // ─── Shared zero vector ───────────────────────────────────────────────────────

  /** Reusable zero vector — used as a default when no origin callback is set. */
  const ZERO_VEC3: Physics3DVec3 = { x: 0, y: 0, z: 0 };

  // ─── RFC-08/09 helper functions ───────────────────────────────────────────────

  /**
   * Emit a one-time warning that a joint operation is unavailable in local mode.
   */
  const _emitLocalJointWarning = (): void => {
    if (import.meta.env.DEV) {
      console.warn(
        '[GWEN:physics3d] Joint API requires WASM physics3d variant — not available in local mode',
      );
    }
  };

  /**
   * Create a no-op dummy joint handle for use in local mode or WASM failure paths.
   *
   * @returns A sentinel joint handle (`0xFFFFFFFF`).
   */
  const _makeDummyJoint = (): JointHandle3D => 0xffffffff;

  /**
   * Wrap a WASM numeric joint id in a {@link JointHandle3D}.
   *
   * @param id - Raw joint id returned by a WASM joint-creation call.
   * @returns The id cast to `JointHandle3D`.
   */
  const _makeJointHandle = (id: number): JointHandle3D => id;

  /**
   * Convert a raw entity slot index back to a typed `EntityId`.
   *
   * Uses `bridgeRuntime.getEntityGeneration` when available so the returned id
   * carries the correct generation bits (consistent with existing event handling).
   *
   * @param index - Entity slot index.
   * @returns A packed `EntityId` (bigint).
   */
  const entityIndexToId = (index: number): EntityId => {
    if (bridgeRuntime?.getEntityGeneration) {
      const gen = bridgeRuntime.getEntityGeneration(index);
      if (gen !== undefined) return createEntityId(index, gen);
    }
    return BigInt(index) as EntityId;
  };

  /** Shared typed-array views for `_u32ToF32` bit-casting (allocated once). */
  const _castU32 = new Uint32Array(1);
  const _castF32 = new Float32Array(_castU32.buffer);

  /**
   * Reusable slot buffer for `detectLocalCollisions`.
   * Refilled each frame via `clear + push` to avoid per-frame spread allocation.
   */
  const _slotsBuffer: number[] = [];

  /**
   * Bit-cast an unsigned 32-bit integer to its IEEE-754 float32 representation.
   *
   * Used to store bitmask values (layers, mask) inside Float32Array SAB slots
   * without numeric precision loss.
   *
   * @param val - Unsigned 32-bit integer value.
   * @returns The same 32 bits reinterpreted as a float32.
   */
  const _u32ToF32 = (val: number): number => {
    _castU32[0] = val >>> 0;
    return _castF32[0]!;
  };

  /**
   * Encode a {@link Physics3DColliderShape} into the 4-float tuple expected by
   * WASM spatial query functions: `[shapeType, p0, p1, p2]`.
   *
   * Shape type encoding:
   * - `0` — box (`p0=halfX, p1=halfY, p2=halfZ`)
   * - `1` — sphere (`p0=radius, p1=0, p2=0`)
   * - `2` — capsule (`p0=radius, p1=halfHeight, p2=0`)
   *
   * Non-primitive shapes (mesh, convex, heightfield) fall back to a unit sphere.
   *
   * @param shape - Collider shape descriptor.
   * @returns `[shapeType, p0, p1, p2]`.
   */
  const encodeShape = (shape: Physics3DColliderShape): [number, number, number, number] => {
    switch (shape.type) {
      case 'box':
        return [0, shape.halfX, shape.halfY, shape.halfZ];
      case 'sphere':
        return [1, shape.radius, 0, 0];
      case 'capsule':
        return [2, shape.radius, shape.halfHeight, 0];
      default:
        // Mesh, convex, heightfield: not supported for spatial queries — fall back to unit sphere
        return [1, 0.5, 0, 0];
    }
  };

  /**
   * Local-mode 3D A* pathfinding on the uploaded voxel grid.
   *
   * Converts world-space `from`/`to` positions to grid cells, runs A* with a
   * 6-connected neighbourhood and Manhattan-3D heuristic, then converts the
   * resulting cell path back to world-space waypoints.
   *
   * Falls back to a two-point path when no grid is available or when A* cannot
   * find a route within the iteration budget.
   *
   * @param from - World-space start position.
   * @param to   - World-space destination.
   * @returns Array of {@link PathWaypoint3D} waypoints from `from` to `to`.
   */
  const _localFindPath3D = (from: Physics3DVec3, to: Physics3DVec3): PathWaypoint3D[] => {
    if (!_localNavGrid) {
      if (import.meta.env.DEV) {
        console.warn(
          '[GWEN:physics3d] findPath3D(): no nav grid uploaded — call initNavGrid3D() first',
        );
      }
      return [{ x: to.x, y: to.y, z: to.z }];
    }

    const { grid, width, height, depth, cellSize } = _localNavGrid;
    const ox = _localNavGrid.origin?.x ?? 0;
    const oy = _localNavGrid.origin?.y ?? 0;
    const oz = _localNavGrid.origin?.z ?? 0;

    /** Convert world position to nearest grid cell (clamped to bounds). */
    const worldToCell = (wx: number, wy: number, wz: number): [number, number, number] => [
      Math.max(0, Math.min(width - 1, Math.round((wx - ox) / cellSize))),
      Math.max(0, Math.min(height - 1, Math.round((wy - oy) / cellSize))),
      Math.max(0, Math.min(depth - 1, Math.round((wz - oz) / cellSize))),
    ];

    /** Convert a grid cell back to world-space centre. */
    const cellToWorld = (cx: number, cy: number, cz: number): PathWaypoint3D => ({
      x: ox + cx * cellSize,
      y: oy + cy * cellSize,
      z: oz + cz * cellSize,
    });

    /** Returns true when cell is within bounds and walkable (grid value === 0). */
    const isWalkable = (cx: number, cy: number, cz: number): boolean => {
      if (cx < 0 || cy < 0 || cz < 0 || cx >= width || cy >= height || cz >= depth) return false;
      return grid[cx + cy * width + cz * width * height] === 0;
    };

    const [sx, sy, sz] = worldToCell(from.x, from.y, from.z);
    const [gx, gy, gz] = worldToCell(to.x, to.y, to.z);
    const goalKey = `${gx},${gy},${gz}`;

    type CellKey = string;
    const gScore = new Map<CellKey, number>();
    const cameFrom = new Map<CellKey, CellKey>();
    type OpenEntry = { key: CellKey; cx: number; cy: number; cz: number };
    const heap = new MinHeap<OpenEntry>();
    const closed = new Set<CellKey>();

    const startKey = `${sx},${sy},${sz}`;
    gScore.set(startKey, 0);
    const h0 = Math.abs(sx - gx) + Math.abs(sy - gy) + Math.abs(sz - gz);
    heap.push({ key: startKey, cx: sx, cy: sy, cz: sz }, h0);

    const MAX_ITER = 4096;
    let found = false;

    for (let iter = 0; iter < MAX_ITER && heap.size > 0; iter++) {
      const cur = heap.pop()!;
      // Skip stale entries (node was already settled with a better path)
      if (closed.has(cur.key)) continue;
      closed.add(cur.key);

      if (cur.key === goalKey) {
        found = true;
        break;
      }

      // 6-connected neighbourhood
      const nb6: [number, number, number][] = [
        [cur.cx + 1, cur.cy, cur.cz],
        [cur.cx - 1, cur.cy, cur.cz],
        [cur.cx, cur.cy + 1, cur.cz],
        [cur.cx, cur.cy - 1, cur.cz],
        [cur.cx, cur.cy, cur.cz + 1],
        [cur.cx, cur.cy, cur.cz - 1],
      ];
      const curG = gScore.get(cur.key) ?? 0;

      for (const [nx, ny, nz] of nb6) {
        if (!isWalkable(nx, ny, nz)) continue;
        const nk = `${nx},${ny},${nz}`;
        if (closed.has(nk)) continue;
        const tentG = curG + 1;
        if (tentG < (gScore.get(nk) ?? Infinity)) {
          gScore.set(nk, tentG);
          cameFrom.set(nk, cur.key);
          const h = Math.abs(nx - gx) + Math.abs(ny - gy) + Math.abs(nz - gz);
          heap.push({ key: nk, cx: nx, cy: ny, cz: nz }, tentG + h);
        }
      }
    }

    if (!found) {
      // No path found — return direct two-point fallback
      return [cellToWorld(sx, sy, sz), cellToWorld(gx, gy, gz)];
    }

    // Reconstruct path by walking back through cameFrom
    const path: PathWaypoint3D[] = [];
    let cur: CellKey | undefined = goalKey;
    while (cur !== undefined) {
      const parts = cur.split(',');
      path.unshift(cellToWorld(Number(parts[0]), Number(parts[1]), Number(parts[2])));
      cur = cameFrom.get(cur);
    }
    return path;
  };

  // ─── Local simulation ─────────────────────────────────────────────────────────

  const createBodyLocal = (
    entityId: Physics3DEntityId,
    options: Physics3DBodyOptions = {},
  ): Physics3DBodyHandle => {
    const slot = toEntityIndex(entityId);
    const handle: Physics3DBodyHandle = {
      bodyId: nextBodyId++,
      entityId,
      kind: options.kind ?? 'dynamic',
      mass: Math.max(0.0001, options.mass ?? 1),
      linearDamping: Math.max(0, options.linearDamping ?? 0),
      angularDamping: Math.max(0, options.angularDamping ?? 0),
    };
    bodyByEntity.set(slot, handle);
    stateByEntity.set(slot, {
      position: vec3(options.initialPosition),
      rotation: quat(options.initialRotation),
      linearVelocity: vec3(options.initialLinearVelocity),
      angularVelocity: vec3(options.initialAngularVelocity),
    });

    // Apply fixedRotation: lock all rotation axes in local mode
    if (options.fixedRotation) {
      const cur = localAxisLocks.get(slot) ?? {
        tx: false,
        ty: false,
        tz: false,
        rx: false,
        ry: false,
        rz: false,
      };
      localAxisLocks.set(slot, { ...cur, rx: true, ry: true, rz: true });
    }

    return handle;
  };

  const removeBodyLocal = (entityId: Physics3DEntityId): boolean => {
    const slot = toEntityIndex(entityId);
    stateByEntity.delete(slot);
    localColliders.delete(slot);
    localForces.delete(slot);
    localTorques.delete(slot);
    localAxisLocks.delete(slot);
    localSleeping.delete(slot);
    localGravityScales.delete(slot);
    return bodyByEntity.delete(slot);
  };

  const advanceLocalState = (deltaSeconds: number): void => {
    for (const [slot, handle] of bodyByEntity.entries()) {
      const state = stateByEntity.get(slot);
      if (!state) continue;

      // Skip sleeping bodies — they do not integrate
      if (localSleeping.has(slot)) continue;

      if (handle.kind === 'dynamic') {
        // Per-body gravity scale (default 1.0)
        const gs = localGravityScales.get(slot) ?? 1.0;
        state.linearVelocity = {
          x: state.linearVelocity.x + cfg.gravity.x * gs * deltaSeconds,
          y: state.linearVelocity.y + cfg.gravity.y * gs * deltaSeconds,
          z: state.linearVelocity.z + cfg.gravity.z * gs * deltaSeconds,
        };

        // Apply accumulated forces: F = m*a → a = F/m → Δv = a*dt
        const force = localForces.get(slot);
        if (force) {
          const invMass = 1 / handle.mass;
          state.linearVelocity = {
            x: state.linearVelocity.x + force.x * invMass * deltaSeconds,
            y: state.linearVelocity.y + force.y * invMass * deltaSeconds,
            z: state.linearVelocity.z + force.z * invMass * deltaSeconds,
          };
          localForces.delete(slot);
        }

        // Apply accumulated torques: τ = I*α → α = τ/I (use unit inertia for local mode)
        const torque = localTorques.get(slot);
        if (torque) {
          const invInertia = 1 / handle.mass; // simplified unit-sphere inertia
          state.angularVelocity = {
            x: state.angularVelocity.x + torque.x * invInertia * deltaSeconds,
            y: state.angularVelocity.y + torque.y * invInertia * deltaSeconds,
            z: state.angularVelocity.z + torque.z * invInertia * deltaSeconds,
          };
          localTorques.delete(slot);
        }
      }

      if (handle.kind === 'fixed') continue;

      // Apply axis locks: zero out locked velocity components before damping/integration
      const locks = localAxisLocks.get(slot);
      if (locks) {
        if (locks.tx) state.linearVelocity = { ...state.linearVelocity, x: 0 };
        if (locks.ty) state.linearVelocity = { ...state.linearVelocity, y: 0 };
        if (locks.tz) state.linearVelocity = { ...state.linearVelocity, z: 0 };
        if (locks.rx) state.angularVelocity = { ...state.angularVelocity, x: 0 };
        if (locks.ry) state.angularVelocity = { ...state.angularVelocity, y: 0 };
        if (locks.rz) state.angularVelocity = { ...state.angularVelocity, z: 0 };
      }

      if (handle.linearDamping > 0) {
        const f = Math.max(0, 1 - handle.linearDamping * deltaSeconds);
        state.linearVelocity = {
          x: state.linearVelocity.x * f,
          y: state.linearVelocity.y * f,
          z: state.linearVelocity.z * f,
        };
      }

      if (handle.angularDamping > 0) {
        const f = Math.max(0, 1 - handle.angularDamping * deltaSeconds);
        state.angularVelocity = {
          x: state.angularVelocity.x * f,
          y: state.angularVelocity.y * f,
          z: state.angularVelocity.z * f,
        };
      }

      state.position = {
        x: state.position.x + state.linearVelocity.x * deltaSeconds,
        y: state.position.y + state.linearVelocity.y * deltaSeconds,
        z: state.position.z + state.linearVelocity.z * deltaSeconds,
      };

      // Integrate angular velocity into the orientation quaternion.
      // Uses exact small-angle quaternion integration to preserve unit length.
      const av = state.angularVelocity;
      const omega = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
      if (omega > 1e-10) {
        const halfAngle = omega * deltaSeconds * 0.5;
        const sinH = Math.sin(halfAngle) / omega;
        const cosH = Math.cos(halfAngle);
        // Rotation delta quaternion (axis * sin(θ/2), cos(θ/2))
        const dqx = av.x * sinH;
        const dqy = av.y * sinH;
        const dqz = av.z * sinH;
        const dqw = cosH;
        // Multiply current rotation by delta: q' = q * dq
        const q = state.rotation;
        const nx = q.w * dqx + q.x * dqw + q.y * dqz - q.z * dqy;
        const ny = q.w * dqy - q.x * dqz + q.y * dqw + q.z * dqx;
        const nz = q.w * dqz + q.x * dqy - q.y * dqx + q.z * dqw;
        const nw = q.w * dqw - q.x * dqx - q.y * dqy - q.z * dqz;
        // Renormalize to prevent numerical drift
        const rlen = Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        if (rlen > 0) {
          state.rotation = { x: nx / rlen, y: ny / rlen, z: nz / rlen, w: nw / rlen };
        }
      }
    }
  };

  // ─── AABB collision detection (local mode) ────────────────────────────────────

  /**
   * Axis-Aligned Bounding Box collision pair detection.
   * Runs O(N²) — acceptable for fallback mode with fewer than 200 bodies.
   *
   * Compares the current overlapping pairs against the previous frame to
   * produce `started` / ended transition events.
   */
  const detectLocalCollisions = (): InternalCollisionEvent3D[] => {
    const currentKeys = new Set<string>();
    type PairRecord = {
      slotA: number;
      slotB: number;
      colliderIdA: number | undefined;
      colliderIdB: number | undefined;
      key: string;
    };
    const currentPairs: PairRecord[] = [];
    // Refill the pre-allocated slot buffer to avoid a per-frame spread allocation.
    _slotsBuffer.length = 0;
    for (const key of bodyByEntity.keys()) _slotsBuffer.push(key);
    const slots = _slotsBuffer;

    for (let i = 0; i < slots.length; i++) {
      const slotA = slots[i]!;
      const stateA = stateByEntity.get(slotA);
      const collidersA = localColliders.get(slotA);
      if (!stateA || !collidersA || collidersA.length === 0) continue;

      for (let j = i + 1; j < slots.length; j++) {
        const slotB = slots[j]!;
        const stateB = stateByEntity.get(slotB);
        const collidersB = localColliders.get(slotB);
        if (!stateB || !collidersB || collidersB.length === 0) continue;

        for (const colA of collidersA) {
          const aabbA = computeColliderAABB(stateA.position, colA);
          for (const colB of collidersB) {
            const aabbB = computeColliderAABB(stateB.position, colB);
            if (!aabbOverlap(aabbA, aabbB)) continue;
            const cIdA = colA.colliderId;
            const cIdB = colB.colliderId;
            const key = `${slotA}:${cIdA ?? -1}:${slotB}:${cIdB ?? -1}`;
            if (!currentKeys.has(key)) {
              currentKeys.add(key);
              currentPairs.push({ slotA, slotB, colliderIdA: cIdA, colliderIdB: cIdB, key });
            }
          }
        }
      }
    }

    const events: InternalCollisionEvent3D[] = [];

    // Newly overlapping pairs → contact started
    for (const pair of currentPairs) {
      if (!previousLocalContactKeys.has(pair.key)) {
        events.push({
          slotA: pair.slotA,
          slotB: pair.slotB,
          aColliderId: pair.colliderIdA,
          bColliderId: pair.colliderIdB,
          started: true,
        });
      }
    }

    // Previously overlapping pairs that no longer overlap → contact ended
    for (const prevKey of previousLocalContactKeys) {
      if (!currentKeys.has(prevKey)) {
        const parts = prevKey.split(':');
        const slotA = parseInt(parts[0] ?? '0', 10);
        const rawCIdA = parseInt(parts[1] ?? '-1', 10);
        const slotB = parseInt(parts[2] ?? '0', 10);
        const rawCIdB = parseInt(parts[3] ?? '-1', 10);
        events.push({
          slotA,
          slotB,
          aColliderId: rawCIdA === -1 ? undefined : rawCIdA,
          bColliderId: rawCIdB === -1 ? undefined : rawCIdB,
          started: false,
        });
      }
    }

    previousLocalContactKeys = currentKeys;
    return events;
  };

  const createBodyWasm = (
    entityId: Physics3DEntityId,
    options: Physics3DBodyOptions = {},
  ): Physics3DBodyHandle => {
    const handle: Physics3DBodyHandle = {
      bodyId: nextBodyId++,
      entityId,
      kind: options.kind ?? 'dynamic',
      mass: Math.max(0.0001, options.mass ?? 1),
      linearDamping: Math.max(0, options.linearDamping ?? 0),
      angularDamping: Math.max(0, options.angularDamping ?? 0),
    };
    const idx = toEntityIndex(entityId);
    wasmBridge!.physics3d_add_body!(
      idx,
      options.initialPosition?.x ?? 0,
      options.initialPosition?.y ?? 0,
      options.initialPosition?.z ?? 0,
      kindToU8(handle.kind),
      handle.mass,
      handle.linearDamping,
      handle.angularDamping,
    );

    // Apply initial rotation / velocity when provided
    const hasInitRot = options.initialRotation && Object.keys(options.initialRotation).length > 0;
    const hasInitVel =
      options.initialLinearVelocity && Object.keys(options.initialLinearVelocity).length > 0;
    const hasInitAng =
      options.initialAngularVelocity && Object.keys(options.initialAngularVelocity).length > 0;
    if (hasInitRot || hasInitVel || hasInitAng) {
      const p = options.initialPosition ?? {};
      const r = options.initialRotation ?? {};
      const lv = options.initialLinearVelocity ?? {};
      const av = options.initialAngularVelocity ?? {};
      wasmBridge!.physics3d_set_body_state!(
        idx,
        p.x ?? 0,
        p.y ?? 0,
        p.z ?? 0,
        r.x ?? 0,
        r.y ?? 0,
        r.z ?? 0,
        r.w ?? 1,
        lv.x ?? 0,
        lv.y ?? 0,
        lv.z ?? 0,
        av.x ?? 0,
        av.y ?? 0,
        av.z ?? 0,
      );
    }

    // Apply fixedRotation: lock all rotation axes when requested
    if (options.fixedRotation) {
      wasmBridge!.physics3d_lock_rotations?.(idx, true, true, true);
    }

    // Apply per-body quality preset (additional solver iterations)
    if (options.quality !== undefined) {
      /** Mapping from quality preset to additional solver iterations. */
      const QUALITY_ITER_MAP: Record<import('../types/config').Physics3DQualityPreset, number> = {
        low: 0,
        medium: 0,
        high: 1,
        esport: 2,
      };
      const iters = QUALITY_ITER_MAP[options.quality] ?? 0;
      if (iters > 0) {
        wasmBridge!.physics3d_set_body_solver_iterations?.(idx, iters);
      }
    }

    bodyByEntity.set(idx, handle);
    return handle;
  };

  const removeBodyWasm = (entityId: Physics3DEntityId): boolean => {
    const slot = toEntityIndex(entityId);
    if (!bodyByEntity.has(slot)) return false;
    wasmBridge!.physics3d_remove_body!(slot);
    bodyByEntity.delete(slot);
    localColliders.delete(slot);
    return true;
  };

  // ─── Unified body API ─────────────────────────────────────────────────────────

  const createBody = (
    entityId: Physics3DEntityId,
    options: Physics3DBodyOptions = {},
  ): Physics3DBodyHandle => {
    // Remove previous body first to avoid duplicate state
    if (bodyByEntity.has(toEntityIndex(entityId))) {
      if (backendMode === 'wasm') removeBodyWasm(entityId);
      else removeBodyLocal(entityId);
    }
    const handle =
      backendMode === 'wasm'
        ? createBodyWasm(entityId, options)
        : createBodyLocal(entityId, options);

    // Attach declared colliders
    for (const [idx, colliderOpts] of (options.colliders ?? []).entries()) {
      const resolved = { ...colliderOpts };
      if (resolved.colliderId === undefined) resolved.colliderId = idx;
      addColliderImpl(entityId, resolved);
    }

    return handle;
  };

  const removeBody = (entityId: Physics3DEntityId): boolean =>
    backendMode === 'wasm' ? removeBodyWasm(entityId) : removeBodyLocal(entityId);

  const hasBody = (entityId: Physics3DEntityId): boolean =>
    bodyByEntity.has(toEntityIndex(entityId));

  const getBodyKind: Physics3DAPI['getBodyKind'] = (entityId) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return undefined;
      const k = wasmBridge!.physics3d_get_body_kind!(slot);
      return k === 255 ? undefined : kindFromU8(k);
    }
    return bodyByEntity.get(slot)?.kind;
  };

  const setBodyKind: Physics3DAPI['setBodyKind'] = (entityId, kind) => {
    const slot = toEntityIndex(entityId);
    const handle = bodyByEntity.get(slot);
    if (!handle) return false;
    handle.kind = kind;
    if (backendMode === 'wasm') {
      return wasmBridge!.physics3d_set_body_kind!(slot, kindToU8(kind)) ?? false;
    }
    return true;
  };

  const getBodyState: Physics3DAPI['getBodyState'] = (entityId) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return undefined;
      const arr = wasmBridge!.physics3d_get_body_state!(slot);
      if (!arr || arr.length < 13) return undefined;
      return parseBodyState(arr);
    }
    const state = stateByEntity.get(slot);
    return state ? cloneState(state) : undefined;
  };

  const setBodyState: Physics3DAPI['setBodyState'] = (entityId, patch) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return false;
      const idx = slot;
      const arr = wasmBridge!.physics3d_get_body_state!(idx);
      if (!arr || arr.length < 13) return false;
      const cur = parseBodyState(arr);
      const p = patch.position ? { ...cur.position, ...patch.position } : cur.position;
      const r = patch.rotation ? { ...cur.rotation, ...patch.rotation } : cur.rotation;
      const lv = patch.linearVelocity
        ? { ...cur.linearVelocity, ...patch.linearVelocity }
        : cur.linearVelocity;
      const av = patch.angularVelocity
        ? { ...cur.angularVelocity, ...patch.angularVelocity }
        : cur.angularVelocity;
      return (
        wasmBridge!.physics3d_set_body_state!(
          idx,
          p.x,
          p.y,
          p.z,
          r.x,
          r.y,
          r.z,
          r.w,
          lv.x,
          lv.y,
          lv.z,
          av.x,
          av.y,
          av.z,
        ) ?? false
      );
    }
    const current = stateByEntity.get(slot);
    if (!current) return false;
    if (patch.position) current.position = { ...current.position, ...patch.position };
    if (patch.rotation) current.rotation = { ...current.rotation, ...patch.rotation };
    if (patch.linearVelocity)
      current.linearVelocity = { ...current.linearVelocity, ...patch.linearVelocity };
    if (patch.angularVelocity)
      current.angularVelocity = { ...current.angularVelocity, ...patch.angularVelocity };
    return true;
  };

  const applyImpulse: Physics3DAPI['applyImpulse'] = (entityId, impulse) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return false;
      return (
        wasmBridge!.physics3d_apply_impulse!(
          slot,
          impulse.x ?? 0,
          impulse.y ?? 0,
          impulse.z ?? 0,
        ) ?? false
      );
    }
    const state = stateByEntity.get(slot);
    const handle = bodyByEntity.get(slot);
    if (!state || !handle) return false;
    const invMass = 1 / handle.mass;
    state.linearVelocity = {
      x: state.linearVelocity.x + (impulse.x ?? 0) * invMass,
      y: state.linearVelocity.y + (impulse.y ?? 0) * invMass,
      z: state.linearVelocity.z + (impulse.z ?? 0) * invMass,
    };
    return true;
  };

  const applyAngularImpulse: Physics3DAPI['applyAngularImpulse'] = (entityId, impulse) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return false;
      return (
        wasmBridge!.physics3d_apply_angular_impulse!(
          slot,
          impulse.x ?? 0,
          impulse.y ?? 0,
          impulse.z ?? 0,
        ) ?? false
      );
    }
    const state = stateByEntity.get(slot);
    const handle = bodyByEntity.get(slot);
    if (!state || !handle) return false;
    // Local approximation: apply angular impulse as direct velocity change
    const invMass = 1 / handle.mass;
    state.angularVelocity = {
      x: state.angularVelocity.x + (impulse.x ?? 0) * invMass,
      y: state.angularVelocity.y + (impulse.y ?? 0) * invMass,
      z: state.angularVelocity.z + (impulse.z ?? 0) * invMass,
    };
    return true;
  };

  /**
   * Apply a continuous torque in the local fallback simulation.
   *
   * Increments angular velocity by `torque / mass`. Has no effect on `'fixed'`
   * bodies. In WASM mode this method is not forwarded to the Rapier3D bridge
   * (returns `false`) — use `applyAngularImpulse` as an alternative.
   */
  const applyTorque: Physics3DAPI['applyTorque'] = (entityId, torque) => {
    const slot = toEntityIndex(entityId);
    // WASM mode: no dedicated torque export in the bridge
    if (backendMode === 'wasm') return false;
    const state = stateByEntity.get(slot);
    const handle = bodyByEntity.get(slot);
    if (!state || !handle) return false;
    if (handle.kind === 'fixed') return false;
    const invMass = 1 / handle.mass;
    state.angularVelocity = {
      x: state.angularVelocity.x + (torque.x ?? 0) * invMass,
      y: state.angularVelocity.y + (torque.y ?? 0) * invMass,
      z: state.angularVelocity.z + (torque.z ?? 0) * invMass,
    };
    return true;
  };

  const getLinearVelocity: Physics3DAPI['getLinearVelocity'] = (entityId) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return undefined;
      const arr = wasmBridge!.physics3d_get_linear_velocity!(slot);
      if (!arr || arr.length < 3) return undefined;
      return { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0 };
    }
    const state = stateByEntity.get(slot);
    return state ? { ...state.linearVelocity } : undefined;
  };

  const setLinearVelocity: Physics3DAPI['setLinearVelocity'] = (entityId, velocity) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return false;
      const arr = wasmBridge!.physics3d_get_linear_velocity!(slot);
      const cx = arr?.[0] ?? 0;
      const cy = arr?.[1] ?? 0;
      const cz = arr?.[2] ?? 0;
      return (
        wasmBridge!.physics3d_set_linear_velocity!(
          slot,
          velocity.x ?? cx,
          velocity.y ?? cy,
          velocity.z ?? cz,
        ) ?? false
      );
    }
    const state = stateByEntity.get(slot);
    if (!state) return false;
    state.linearVelocity = {
      x: velocity.x ?? state.linearVelocity.x,
      y: velocity.y ?? state.linearVelocity.y,
      z: velocity.z ?? state.linearVelocity.z,
    };
    return true;
  };

  const getAngularVelocity: Physics3DAPI['getAngularVelocity'] = (entityId) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return undefined;
      const arr = wasmBridge!.physics3d_get_angular_velocity!(slot);
      if (!arr || arr.length < 3) return undefined;
      return { x: arr[0] ?? 0, y: arr[1] ?? 0, z: arr[2] ?? 0 };
    }
    const state = stateByEntity.get(slot);
    return state ? { ...state.angularVelocity } : undefined;
  };

  const setAngularVelocity: Physics3DAPI['setAngularVelocity'] = (entityId, velocity) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return false;
      const arr = wasmBridge!.physics3d_get_angular_velocity!(slot);
      const cx = arr?.[0] ?? 0;
      const cy = arr?.[1] ?? 0;
      const cz = arr?.[2] ?? 0;
      return (
        wasmBridge!.physics3d_set_angular_velocity!(
          slot,
          velocity.x ?? cx,
          velocity.y ?? cy,
          velocity.z ?? cz,
        ) ?? false
      );
    }
    const state = stateByEntity.get(slot);
    if (!state) return false;
    state.angularVelocity = {
      x: velocity.x ?? state.angularVelocity.x,
      y: velocity.y ?? state.angularVelocity.y,
      z: velocity.z ?? state.angularVelocity.z,
    };
    return true;
  };

  const setKinematicPosition: Physics3DAPI['setKinematicPosition'] = (
    entityId,
    position,
    rotation,
  ) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm') {
      if (!bodyByEntity.has(slot)) return false;
      const r = rotation ?? { x: 0, y: 0, z: 0, w: 1 };
      return (
        wasmBridge!.physics3d_set_kinematic_position!(
          slot,
          position.x,
          position.y,
          position.z,
          r.x,
          r.y,
          r.z,
          r.w,
        ) ?? false
      );
    }
    const state = stateByEntity.get(slot);
    if (!state) return false;
    state.position = { ...position };
    if (rotation) state.rotation = { ...state.rotation, ...rotation };
    return true;
  };

  // ─── Collider management ──────────────────────────────────────────────────────

  /** Convert a single {@link CompoundShapeSpec} entry into {@link Physics3DColliderOptions}. */
  const shapeSpecToColliderOptions = (
    shape: CompoundShapeSpec,
    colliderId: number,
    layers: (string | number)[] | undefined,
    mask: (string | number)[] | undefined,
  ): Physics3DColliderOptions => {
    const common = {
      colliderId,
      offsetX: shape.offsetX,
      offsetY: shape.offsetY,
      offsetZ: shape.offsetZ,
      isSensor: shape.isSensor,
      friction: shape.friction,
      restitution: shape.restitution,
      layers,
      mask,
    };
    switch (shape.type) {
      case 'box':
        return {
          ...common,
          shape: { type: 'box', halfX: shape.halfX, halfY: shape.halfY, halfZ: shape.halfZ },
        };
      case 'sphere':
        return { ...common, shape: { type: 'sphere', radius: shape.radius } };
      case 'capsule':
        return {
          ...common,
          shape: { type: 'capsule', radius: shape.radius, halfHeight: shape.halfHeight },
        };
    }
  };

  /**
   * Internal implementation of addCollider — shared by createBody collider loop
   * and the public addCollider API method.
   */
  const addColliderImpl = (
    entityId: Physics3DEntityId,
    options: Physics3DColliderOptions,
  ): boolean => {
    const slot = toEntityIndex(entityId);
    if (!bodyByEntity.has(slot)) return false;

    const colliderId = options.colliderId ?? nextColliderIdForEntity(entityId);
    const finalOptions: Physics3DColliderOptions = { ...options, colliderId };

    // Always track in the local collider registry for inspection
    if (!localColliders.has(slot)) localColliders.set(slot, []);
    localColliders.get(slot)!.push(finalOptions);

    if (backendMode === 'wasm') {
      const idx = toEntityIndex(entityId);
      const { friction, restitution, density } = resolveColliderMaterial(finalOptions);
      const isSensor = finalOptions.isSensor ? 1 : 0;
      const membership = resolveLayerBits(finalOptions.layers, layerRegistry);
      const filter = resolveLayerBits(finalOptions.mask, layerRegistry);
      const ox = finalOptions.offsetX ?? 0;
      const oy = finalOptions.offsetY ?? 0;
      const oz = finalOptions.offsetZ ?? 0;
      const shape = finalOptions.shape;

      if (shape.type === 'box') {
        return (
          wasmBridge!.physics3d_add_box_collider?.(
            idx,
            shape.halfX,
            shape.halfY,
            shape.halfZ,
            friction,
            restitution,
            density,
            isSensor,
            membership,
            filter,
            colliderId,
            ox,
            oy,
            oz,
          ) ?? false
        );
      }
      if (shape.type === 'sphere') {
        return (
          wasmBridge!.physics3d_add_sphere_collider?.(
            idx,
            shape.radius,
            friction,
            restitution,
            density,
            isSensor,
            membership,
            filter,
            colliderId,
            ox,
            oy,
            oz,
          ) ?? false
        );
      }
      if (shape.type === 'capsule') {
        return (
          wasmBridge!.physics3d_add_capsule_collider?.(
            idx,
            shape.radius,
            shape.halfHeight,
            friction,
            restitution,
            density,
            isSensor,
            membership,
            filter,
            colliderId,
            ox,
            oy,
            oz,
          ) ?? false
        );
      }
      if (shape.type === 'heightfield') {
        return (
          wasmBridge!.physics3d_add_heightfield_collider?.(
            idx,
            shape.heights,
            shape.rows,
            shape.cols,
            shape.scaleX ?? 1,
            shape.scaleY ?? 1,
            shape.scaleZ ?? 1,
            friction,
            restitution,
            membership,
            filter,
            colliderId,
          ) ?? false
        );
      }
      if (shape.type === 'mesh') {
        // ── Async path: pre-baked BVH URL ───────────────────────────────────
        if (finalOptions.__bvhUrl) {
          const bvhUrl = finalOptions.__bvhUrl;
          const ac = new AbortController();
          let resolveReady!: () => void;
          let rejectReady!: (e: unknown) => void;
          const ready = new Promise<void>((res, rej) => {
            resolveReady = res;
            rejectReady = rej;
          });

          _fetchBvhBuffer(bvhUrl)
            .then((ab) => {
              if (ac.signal.aborted) return;
              const ok =
                wasmBridge!.physics3d_load_bvh_collider?.(
                  idx,
                  new Uint8Array(ab),
                  ox,
                  oy,
                  oz,
                  finalOptions.isSensor ?? false,
                  friction,
                  restitution,
                  membership,
                  filter,
                  colliderId,
                ) ?? false;
              if (ok) resolveReady();
              else
                rejectReady(
                  new Error('[GWEN:Physics3D] physics3d_load_bvh_collider returned false'),
                );
            })
            .catch(rejectReady);

          _pendingBvhLoads.set(colliderId, { ac, ready });
          return true;
        }
        // ── Sync path: inline vertices + indices ─────────────────────────────
        // For large meshes, delegate BVH construction to the off-main-thread worker.
        const triCount = shape.indices.length / 3;
        if (triCount >= BVH_WORKER_THRESHOLD && typeof Worker !== 'undefined') {
          const jobId = getNextBvhJobId();
          const ac = new AbortController();
          let resolveReady!: () => void;
          let rejectReady!: (e: unknown) => void;
          const ready = new Promise<void>((res, rej) => {
            resolveReady = res;
            rejectReady = rej;
          });

          registerBvhCallback(
            jobId,
            (bvhBytes: Uint8Array) => {
              if (ac.signal.aborted) return;
              const ok =
                wasmBridge!.physics3d_load_bvh_collider?.(
                  idx,
                  bvhBytes,
                  ox,
                  oy,
                  oz,
                  finalOptions.isSensor ?? false,
                  friction,
                  restitution,
                  membership,
                  filter,
                  colliderId,
                ) ?? false;
              if (ok) resolveReady();
              else
                rejectReady(
                  new Error('[GWEN:Physics3D] physics3d_load_bvh_collider returned false'),
                );
            },
            rejectReady,
          );

          try {
            // Transfer the typed array buffers to the worker (zero-copy).
            const vBuf = shape.vertices.buffer.slice(0) as ArrayBuffer;
            const iBuf = shape.indices.buffer.slice(0) as ArrayBuffer;
            getBvhWorker().postMessage(
              {
                id: jobId,
                vertices: new Float32Array(vBuf),
                indices: new Uint32Array(iBuf),
              },
              [vBuf, iBuf],
            );
          } catch (e) {
            _bvhWorkerCallbacks.delete(jobId);
            rejectReady(e);
          }

          _pendingBvhLoads.set(colliderId, { ac, ready });
          return true;
        }

        return (
          wasmBridge!.physics3d_add_mesh_collider?.(
            idx,
            shape.vertices,
            shape.indices,
            ox,
            oy,
            oz,
            isSensor,
            friction,
            restitution,
            membership,
            filter,
            colliderId,
          ) ?? false
        );
      }
      if (shape.type === 'convex') {
        return (
          wasmBridge!.physics3d_add_convex_collider?.(
            idx,
            shape.vertices,
            ox,
            oy,
            oz,
            isSensor,
            friction,
            restitution,
            density,
            membership,
            filter,
            colliderId,
          ) ?? false
        );
      }
    }

    // Emit warnings for unimplemented shape types in local mode
    if (backendMode === 'local') {
      const shape = finalOptions.shape;
      if (shape.type === 'mesh') {
        console.warn(
          '[PHYSICS3D:MESH_FALLBACK] useMeshCollider() is not yet fully implemented. ' +
            'Falling back to a 1×1×1 box collider. Upgrade to a build with RFC-06b support.',
        );
      } else if (shape.type === 'convex') {
        console.warn(
          '[PHYSICS3D:CONVEX_FALLBACK] useConvexCollider() is not yet fully implemented. ' +
            'Falling back to a 1×1×1 box collider. Upgrade to a build with RFC-06b support.',
        );
      }
    }

    return true;
  };

  const addCollider: Physics3DAPI['addCollider'] = (entityId, options) =>
    addColliderImpl(entityId, options);

  const removeCollider: Physics3DAPI['removeCollider'] = (entityId, colliderId) => {
    const slot = toEntityIndex(entityId);
    if (!bodyByEntity.has(slot)) return false;

    const colliders = localColliders.get(slot);
    if (colliders) {
      const idx = colliders.findIndex((c) => c.colliderId === colliderId);
      if (idx !== -1) colliders.splice(idx, 1);
    }

    if (backendMode === 'wasm') {
      return wasmBridge!.physics3d_remove_collider?.(slot, colliderId) ?? false;
    }

    return true;
  };

  const rebuildMeshCollider: Physics3DAPI['rebuildMeshCollider'] = (
    entityId,
    colliderId,
    vertices,
    indices,
    options,
  ) => {
    const slot = toEntityIndex(entityId);
    if (!bodyByEntity.has(slot)) return false;

    // Update local collider registry with new geometry.
    const colliders = localColliders.get(slot);
    if (colliders) {
      const entry = colliders.find((c) => c.colliderId === colliderId);
      if (entry && entry.shape.type === 'mesh') {
        entry.shape.vertices = vertices;
        entry.shape.indices = indices;
      }
    }

    if (backendMode !== 'wasm') return true;

    const { friction, restitution } = resolveColliderMaterial({
      ...options,
    } as Physics3DColliderOptions);
    const isSensor = options?.isSensor ?? false;
    const membership = resolveLayerBits(options?.layers, layerRegistry);
    const filter = resolveLayerBits(options?.mask, layerRegistry);

    return (
      wasmBridge!.physics3d_rebuild_mesh_collider?.(
        slot,
        colliderId,
        vertices,
        indices,
        0,
        0,
        0,
        isSensor,
        friction,
        restitution,
        membership,
        filter,
      ) ?? false
    );
  };

  /**
   * Spawn N static box rigid bodies in a single operation.
   *
   * In WASM mode a single Rust call is made via `physics3d_bulk_spawn_static_boxes`,
   * amortising the per-body overhead for large amounts of static geometry.
   * In local mode bodies are created one-by-one via `createBodyLocal`.
   */
  const bulkSpawnStaticBoxes = (options: BulkStaticBoxesOptions): BulkStaticBoxesResult => {
    if (options.positions.length % 3 !== 0) {
      throw new RangeError(
        `[GWEN:Physics3D] positions.length must be a multiple of 3, got ${options.positions.length}`,
      );
    }
    const n = options.positions.length / 3;
    const friction = options.friction ?? 0.5;
    const restitution = options.restitution ?? 0.0;
    const membership = resolveLayerBits(options.layers, layerRegistry);
    const filter = resolveLayerBits(options.mask, layerRegistry);

    // Create N ECS entities
    const entityIds: EntityId[] = [];
    const entityIndices = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const eid = _engine!.createEntity();
      entityIds.push(eid);
      entityIndices[i] = toEntityIndex(eid as unknown as Physics3DEntityId);
    }

    if (backendMode === 'wasm' && wasmBridge!.physics3d_bulk_spawn_static_boxes) {
      const spawned = wasmBridge!.physics3d_bulk_spawn_static_boxes(
        entityIndices,
        options.positions,
        options.halfExtents,
        friction,
        restitution,
        membership,
        filter,
      );
      // Register only the successfully spawned handles in bodyByEntity.
      // `spawned` may be less than `n` if Rapier allocation fails for some entries.
      for (let i = 0; i < spawned; i++) {
        const handle: Physics3DBodyHandle = {
          bodyId: nextBodyId++,
          entityId: entityIds[i] as unknown as Physics3DEntityId,
          kind: 'fixed',
          mass: 0,
          linearDamping: 0,
          angularDamping: 0,
        };
        bodyByEntity.set(entityIndices[i]!, handle);
      }
      return { entityIds: entityIds.slice(0, spawned), count: spawned };
    }

    // Local fallback — create bodies one by one
    for (let i = 0; i < n; i++) {
      const px = options.positions[i * 3]!;
      const py = options.positions[i * 3 + 1]!;
      const pz = options.positions[i * 3 + 2]!;
      const uniform = options.halfExtents.length === 3;
      const hx = uniform ? options.halfExtents[0]! : options.halfExtents[i * 3]!;
      const hy = uniform ? options.halfExtents[1]! : options.halfExtents[i * 3 + 1]!;
      const hz = uniform ? options.halfExtents[2]! : options.halfExtents[i * 3 + 2]!;

      createBodyLocal(entityIds[i] as unknown as Physics3DEntityId, {
        kind: 'fixed',
        initialPosition: { x: px, y: py, z: pz },
        colliders: [
          {
            shape: { type: 'box', halfX: hx, halfY: hy, halfZ: hz },
            friction,
            restitution,
            layers: options.layers,
            mask: options.mask,
          },
        ],
      });
    }
    return { entityIds, count: n };
  };

  const addCompoundCollider: Physics3DAPI['addCompoundCollider'] = (entityId, options) => {
    const slot = toEntityIndex(entityId);
    if (!bodyByEntity.has(slot)) return null;

    const { shapes, layers, mask } = options;
    const colliderIds = shapes.map(() => nextColliderId());

    if (backendMode === 'wasm' && wasmBridge?.physics3d_add_compound_collider) {
      const layerBits = resolveLayerBits(layers, layerRegistry);
      const maskBits = resolveLayerBits(mask, layerRegistry);
      const buf = encodeCompoundShapes(shapes, colliderIds);
      const count = wasmBridge.physics3d_add_compound_collider(slot, buf, layerBits, maskBits);

      if (count !== shapes.length) return null;

      // Mirror into local collider registry for inspection and removeBody cleanup.
      if (!localColliders.has(slot)) localColliders.set(slot, []);
      shapes.forEach((shape, i) => {
        localColliders
          .get(slot)!
          .push(shapeSpecToColliderOptions(shape, colliderIds[i]!, layers, mask));
      });
    } else {
      // Local-simulation fallback: insert each shape individually.
      shapes.forEach((shape, i) => {
        addColliderImpl(entityId, shapeSpecToColliderOptions(shape, colliderIds[i]!, layers, mask));
      });
    }

    return {
      colliderIds,
      remove() {
        colliderIds.forEach((id) => removeCollider(entityId, id));
      },
    };
  };

  // ─── Sensor state ─────────────────────────────────────────────────────────────

  const getSensorState: Physics3DAPI['getSensorState'] = (entityId, sensorId) => {
    const slot = toEntityIndex(entityId);
    if (backendMode === 'wasm' && wasmBridge!.physics3d_get_sensor_state) {
      const raw = wasmBridge!.physics3d_get_sensor_state(slot, sensorId);
      if (raw && (raw as unknown[]).length >= 2) {
        const contactCount = Number((raw as number[])[0]);
        const isActive = Number((raw as number[])[1]) !== 0;
        // Sync local cache
        let sensorMap = localSensorStates.get(slot);
        if (!sensorMap) {
          sensorMap = new Map();
          localSensorStates.set(slot, sensorMap);
        }
        sensorMap.set(sensorId, { contactCount, isActive });
        return { contactCount, isActive };
      }
    }
    return localSensorStates.get(slot)?.get(sensorId) ?? { contactCount: 0, isActive: false };
  };

  const updateSensorState: Physics3DAPI['updateSensorState'] = (
    entityId,
    sensorId,
    isActive,
    count,
  ) => {
    const slot = toEntityIndex(entityId);
    let sensorMap = localSensorStates.get(slot);
    if (!sensorMap) {
      sensorMap = new Map();
      localSensorStates.set(slot, sensorMap);
    }
    sensorMap.set(sensorId, { contactCount: count, isActive });
    if (backendMode === 'wasm' && wasmBridge!.physics3d_update_sensor_state) {
      wasmBridge!.physics3d_update_sensor_state(slot, sensorId, isActive ? 1 : 0, count);
    }
  };

  // ─── Collision event reading from WASM ring buffer ────────────────────────────

  /**
   * Read pending collision events from the WASM ring buffer.
   *
   * Event layout (17 bytes per slot):
   * [slotA u32 LE][slotB u32 LE][colliderIdA u32 LE][colliderIdB u32 LE][flags u8]
   * flags bit 0: 1 = contact started, 0 = contact ended
   */
  const readWasmCollisionEvents = (): InternalCollisionEvent3D[] => {
    if (!wasmBridge) return [];
    const pb = wasmBridge;
    if (!pb.physics3d_get_collision_events_ptr || !pb.physics3d_get_collision_event_count) {
      return [];
    }

    const memory = bridgeRuntime?.getLinearMemory?.() ?? pb.memory ?? null;
    if (!memory) return [];

    const ptr = pb.physics3d_get_collision_events_ptr();
    const count = Math.min(pb.physics3d_get_collision_event_count(), MAX_EVENTS_3D);
    if (count === 0) return [];

    // Build a DataView covering the available bytes from ptr to end of buffer.
    // We read only `count` events, so we do not require the full ring capacity.
    const availableBytes = memory.buffer.byteLength - ptr;
    if (availableBytes <= 0) return [];

    if (!eventsView || eventsBufferRef !== memory.buffer || eventsView.byteLength === 0) {
      eventsBufferRef = memory.buffer;
      eventsView = new DataView(memory.buffer, ptr, availableBytes);
    }

    // Reuse pooled array — grow if needed, truncate via length tracking
    pooledEvents.length = count;
    for (let i = 0; i < count; i++) {
      const base = i * EVENT_STRIDE_3D;
      // Rust layout: [entity_a u32][entity_b u32][flags u32][collider_a_id u16][collider_b_id u16]
      const slotA = eventsView.getUint32(base, true);
      const slotB = eventsView.getUint32(base + 4, true);
      const rawFlags = eventsView.getUint32(base + 8, true);
      const rawColliderA = eventsView.getUint16(base + 12, true);
      const rawColliderB = eventsView.getUint16(base + 14, true);

      const existing = pooledEvents[i];
      if (existing) {
        existing.slotA = slotA;
        existing.slotB = slotB;
        existing.aColliderId = rawColliderA === COLLIDER_ID_ABSENT ? undefined : rawColliderA;
        existing.bColliderId = rawColliderB === COLLIDER_ID_ABSENT ? undefined : rawColliderB;
        existing.started = (rawFlags & 1) === 1;
      } else {
        pooledEvents[i] = {
          slotA,
          slotB,
          aColliderId: rawColliderA === COLLIDER_ID_ABSENT ? undefined : rawColliderA,
          bColliderId: rawColliderB === COLLIDER_ID_ABSENT ? undefined : rawColliderB,
          started: (rawFlags & 1) === 1,
        };
      }
    }

    pb.physics3d_consume_events?.();
    lastFrameEventCount = count;
    return pooledEvents;
  };

  // ─── Service object ───────────────────────────────────────────────────────────

  /**
   * Returns a {@link CharacterControllerHandle} whose `move()` is a no-op and
   * all state properties return safe defaults.  Used when the Rust CC pool is
   * exhausted (WASM returns `0xffffffff`).
   */
  const createInertCharacterControllerHandle = (): CharacterControllerHandle => {
    const zero: Physics3DVec3 = { x: 0, y: 0, z: 0 };
    return {
      get isGrounded() {
        return false;
      },
      get groundNormal() {
        return null;
      },
      get groundEntity() {
        return null;
      },
      get lastTranslation() {
        return zero;
      },
      move(_desiredVelocity: Physics3DVec3, _dt: number) {
        // Pool exhausted — intentional no-op.
      },
    } satisfies CharacterControllerHandle;
  };

  const service: Physics3DAPI = {
    isReady: () => ready,
    variant: () => _variant,

    step: (deltaSeconds: number) => {
      if (!stepFn) {
        throw new Error('[GWEN:Physics3D] step() called before plugin initialization.');
      }
      stepFn(deltaSeconds);
      if (deltaSeconds > 0 && backendMode === 'local') {
        advanceLocalState(deltaSeconds);
      }
    },

    createBody,
    removeBody,
    hasBody,
    getBodyKind,
    setBodyKind,
    getBodyState,
    setBodyState,
    applyImpulse,
    applyAngularImpulse,
    applyTorque,
    getLinearVelocity,
    setLinearVelocity,
    getAngularVelocity,
    setAngularVelocity,
    setKinematicPosition,
    bulkStepKinematics: (slots, vx, vy, vz, dt) => {
      return wasmBridge?.physics3d_bulk_step_kinematics?.(slots, vx, vy, vz, dt) ?? 0;
    },
    bulkStepKinematicRotations: (slots, wx, wy, wz, dt) => {
      return wasmBridge?.physics3d_bulk_step_kinematic_rotations?.(slots, wx, wy, wz, dt) ?? 0;
    },
    addCollider,
    removeCollider,
    rebuildMeshCollider,
    bulkSpawnStaticBoxes,
    addCompoundCollider,
    getSensorState,
    updateSensorState,

    _getBvhLoadState: (colliderId: number) => {
      const pending = _pendingBvhLoads.get(colliderId);
      if (!pending) return null;
      return {
        ready: pending.ready,
        abort: () => pending.ac.abort(),
      };
    },

    getCollisionContacts: (opts) =>
      opts?.max !== undefined ? currentFrameContacts.slice(0, opts.max) : currentFrameContacts,

    getCollisionEventMetrics: () => ({ eventCount: lastFrameEventCount }),

    getBodySnapshot: (entityId) => {
      if (!bodyByEntity.has(toEntityIndex(entityId))) return undefined;
      const state = getBodyState(entityId);
      return {
        entityId,
        position: state?.position ?? null,
        rotation: state?.rotation ?? null,
        linearVelocity: state?.linearVelocity ?? null,
        angularVelocity: state?.angularVelocity ?? null,
      };
    },

    getBodyCount: () => bodyByEntity.size,

    isDebugEnabled: () => cfg.debug,

    // ─── RFC-08: Joint API ────────────────────────────────────────────────────

    addFixedJoint(opts: FixedJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};

      if (backendMode === 'wasm') {
        const id =
          wasmBridge!.physics3d_add_fixed_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          _emitLocalJointWarning();
          return _makeDummyJoint();
        }
        return _makeJointHandle(id);
      }

      _emitLocalJointWarning();
      return _makeDummyJoint();
    },

    addRevoluteJoint(opts: RevoluteJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const axis = opts.axis ?? {};
      const useLimits = opts.limits !== undefined;
      const limitMin = opts.limits?.[0] ?? 0;
      const limitMax = opts.limits?.[1] ?? 0;

      if (backendMode === 'wasm') {
        const id =
          wasmBridge!.physics3d_add_revolute_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            axis.x ?? 0,
            axis.y ?? 1,
            axis.z ?? 0,
            useLimits,
            limitMin,
            limitMax,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          _emitLocalJointWarning();
          return _makeDummyJoint();
        }
        return _makeJointHandle(id);
      }

      _emitLocalJointWarning();
      return _makeDummyJoint();
    },

    addPrismaticJoint(opts: PrismaticJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const axis = opts.axis ?? {};
      const useLimits = opts.limits !== undefined;
      const limitMin = opts.limits?.[0] ?? 0;
      const limitMax = opts.limits?.[1] ?? 0;

      if (backendMode === 'wasm') {
        const id =
          wasmBridge!.physics3d_add_prismatic_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            axis.x ?? 0,
            axis.y ?? 1,
            axis.z ?? 0,
            useLimits,
            limitMin,
            limitMax,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          _emitLocalJointWarning();
          return _makeDummyJoint();
        }
        return _makeJointHandle(id);
      }

      _emitLocalJointWarning();
      return _makeDummyJoint();
    },

    addBallJoint(opts: BallJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};
      const useConeLimit = opts.coneAngle !== undefined;
      const coneAngle = opts.coneAngle ?? 0;

      if (backendMode === 'wasm') {
        const id =
          wasmBridge!.physics3d_add_ball_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            useConeLimit,
            coneAngle,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          _emitLocalJointWarning();
          return _makeDummyJoint();
        }
        return _makeJointHandle(id);
      }

      _emitLocalJointWarning();
      return _makeDummyJoint();
    },

    addSpringJoint(opts: SpringJointOpts): JointHandle3D {
      const slotA = toEntityIndex(opts.bodyA as EntityId);
      const slotB = toEntityIndex(opts.bodyB as EntityId);
      const a = opts.anchorA ?? {};
      const b = opts.anchorB ?? {};

      if (backendMode === 'wasm') {
        const id =
          wasmBridge!.physics3d_add_spring_joint?.(
            slotA,
            slotB,
            a.x ?? 0,
            a.y ?? 0,
            a.z ?? 0,
            b.x ?? 0,
            b.y ?? 0,
            b.z ?? 0,
            opts.restLength,
            opts.stiffness,
            opts.damping,
          ) ?? 0xffffffff;
        if (id === 0xffffffff) {
          _emitLocalJointWarning();
          return _makeDummyJoint();
        }
        return _makeJointHandle(id);
      }

      _emitLocalJointWarning();
      return _makeDummyJoint();
    },

    removeJoint(id: JointId): void {
      if (backendMode !== 'wasm') return;
      wasmBridge!.physics3d_remove_joint?.(id as number);
    },

    setJointMotorVelocity(id: JointId, velocity: number, maxForce: number): void {
      if (backendMode !== 'wasm') return;
      wasmBridge!.physics3d_set_joint_motor_velocity?.(id as number, velocity, maxForce);
    },

    setJointMotorPosition(id: JointId, target: number, stiffness: number, damping: number): void {
      if (backendMode !== 'wasm') return;
      wasmBridge!.physics3d_set_joint_motor_position?.(id as number, target, stiffness, damping);
    },

    setJointEnabled(id: JointId, enabled: boolean): void {
      if (backendMode !== 'wasm') return;
      wasmBridge!.physics3d_set_joint_enabled?.(id as number, enabled);
    },

    // ─── RFC-10: Continuous forces ────────────────────────────────────────────

    addForce(entityId: Physics3DEntityId, force: Partial<Physics3DVec3>): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_add_force?.(slot, force.x ?? 0, force.y ?? 0, force.z ?? 0);
        return;
      }
      const acc = localForces.get(slot) ?? { x: 0, y: 0, z: 0 };
      localForces.set(slot, {
        x: acc.x + (force.x ?? 0),
        y: acc.y + (force.y ?? 0),
        z: acc.z + (force.z ?? 0),
      });
    },

    addTorque(entityId: Physics3DEntityId, torque: Partial<Physics3DVec3>): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_add_torque?.(slot, torque.x ?? 0, torque.y ?? 0, torque.z ?? 0);
        return;
      }
      const acc = localTorques.get(slot) ?? { x: 0, y: 0, z: 0 };
      localTorques.set(slot, {
        x: acc.x + (torque.x ?? 0),
        y: acc.y + (torque.y ?? 0),
        z: acc.z + (torque.z ?? 0),
      });
    },

    addForceAtPoint(
      entityId: Physics3DEntityId,
      force: Partial<Physics3DVec3>,
      point: Partial<Physics3DVec3>,
    ): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_add_force_at_point?.(
          slot,
          force.x ?? 0,
          force.y ?? 0,
          force.z ?? 0,
          point.x ?? 0,
          point.y ?? 0,
          point.z ?? 0,
        );
        return;
      }
      // Local fallback: approximate as center-of-mass force (no torque contribution)
      const acc = localForces.get(slot) ?? { x: 0, y: 0, z: 0 };
      localForces.set(slot, {
        x: acc.x + (force.x ?? 0),
        y: acc.y + (force.y ?? 0),
        z: acc.z + (force.z ?? 0),
      });
    },

    // ─── RFC-10: Gravity scale ────────────────────────────────────────────────

    setGravityScale(entityId: Physics3DEntityId, scale: number): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_set_gravity_scale?.(slot, scale);
        return;
      }
      localGravityScales.set(slot, scale);
    },

    getGravityScale(entityId: Physics3DEntityId): number {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        return wasmBridge!.physics3d_get_gravity_scale?.(slot) ?? 1.0;
      }
      return localGravityScales.get(slot) ?? 1.0;
    },

    // ─── RFC-10: Axis locks ────────────────────────────────────────────────────

    lockTranslations(entityId: Physics3DEntityId, x: boolean, y: boolean, z: boolean): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_lock_translations?.(slot, x, y, z);
        return;
      }
      const cur = localAxisLocks.get(slot) ?? {
        tx: false,
        ty: false,
        tz: false,
        rx: false,
        ry: false,
        rz: false,
      };
      localAxisLocks.set(slot, {
        ...cur,
        tx: x || cur.tx,
        ty: y || cur.ty,
        tz: z || cur.tz,
      });
    },

    lockRotations(entityId: Physics3DEntityId, x: boolean, y: boolean, z: boolean): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_lock_rotations?.(slot, x, y, z);
        return;
      }
      const cur = localAxisLocks.get(slot) ?? {
        tx: false,
        ty: false,
        tz: false,
        rx: false,
        ry: false,
        rz: false,
      };
      localAxisLocks.set(slot, {
        ...cur,
        rx: x || cur.rx,
        ry: y || cur.ry,
        rz: z || cur.rz,
      });
    },

    // ─── RFC-10: Sleep control ────────────────────────────────────────────────

    setBodySleeping(entityId: Physics3DEntityId, sleeping: boolean): void {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_set_body_sleeping?.(slot, sleeping);
        return;
      }
      if (sleeping) {
        localSleeping.add(slot);
      } else {
        localSleeping.delete(slot);
      }
    },

    isBodySleeping(entityId: Physics3DEntityId): boolean {
      const slot = toEntityIndex(entityId as EntityId);
      if (backendMode === 'wasm') {
        return wasmBridge!.physics3d_is_body_sleeping?.(slot) ?? false;
      }
      return localSleeping.has(slot);
    },

    wakeAll(): void {
      if (backendMode === 'wasm') {
        wasmBridge!.physics3d_wake_all?.();
        return;
      }
      localSleeping.clear();
    },

    // ─── RFC-10: Pathfinding 3D ───────────────────────────────────────────────

    initNavGrid3D(opts: Pathfinding3DOptions): void {
      if (backendMode === 'wasm') {
        const pb = wasmBridge! as unknown as Record<string, unknown>;
        const allocFn = pb.__wbindgen_malloc as
          | ((size: number, align: number) => number)
          | undefined;
        const freeFn = pb.__wbindgen_free as
          | ((ptr: number, size: number, align: number) => void)
          | undefined;
        const wasmMem = bridgeRuntime?.getLinearMemory?.();
        if (typeof allocFn === 'function' && wasmMem) {
          const ptr = allocFn.call(wasmBridge, opts.grid.byteLength, 1);
          new Uint8Array(wasmMem.buffer, ptr, opts.grid.byteLength).set(opts.grid);
          wasmBridge!.physics3d_init_navgrid_3d?.(
            ptr,
            opts.width,
            opts.height,
            opts.depth,
            opts.cellSize,
            opts.origin?.x ?? 0,
            opts.origin?.y ?? 0,
            opts.origin?.z ?? 0,
          );
          freeFn?.call(wasmBridge, ptr, opts.grid.byteLength, 1);
        }
        return;
      }
      // Local mode: store for JS A* use
      _localNavGrid = opts;
    },

    findPath3D(from: Physics3DVec3, to: Physics3DVec3): PathWaypoint3D[] {
      if (backendMode === 'wasm') {
        const count = wasmBridge!.physics3d_find_path_3d?.(
          from.x,
          from.y,
          from.z,
          to.x,
          to.y,
          to.z,
        );
        if (!count || count === 0) return [];
        const ptr = wasmBridge!.physics3d_get_path_buffer_ptr_3d?.();
        if (!ptr) return [];
        const wasmMem = bridgeRuntime?.getLinearMemory?.();
        if (!wasmMem) return [];
        const floats = new Float32Array(wasmMem.buffer, ptr, count * 3);
        const path: PathWaypoint3D[] = [];
        for (let i = 0; i < count; i++) {
          path.push({
            x: floats[i * 3]!,
            y: floats[i * 3 + 1]!,
            z: floats[i * 3 + 2]!,
          });
        }
        return path;
      }
      return _localFindPath3D(from, to);
    },

    // ─── RFC-07: Spatial queries — imperative ─────────────────────────────────

    castRay(
      origin: Physics3DVec3,
      direction: Physics3DVec3,
      maxDist: number,
      opts: { layers?: number; mask?: number; solid?: boolean } = {},
    ): RayHit | null {
      if (backendMode === 'wasm') {
        const { layers = 0xffffffff, mask = 0xffffffff, solid = true } = opts;
        const result = wasmBridge!.physics3d_cast_ray?.(
          origin.x,
          origin.y,
          origin.z,
          direction.x,
          direction.y,
          direction.z,
          maxDist,
          layers,
          mask,
          solid ? 1 : 0,
        );
        if (!result || result.length < 9 || result[0] === 0) return null;
        const entityIndex = result[1] as number;
        return {
          entity: entityIndexToId(entityIndex),
          distance: result[2]!,
          normal: { x: result[3]!, y: result[4]!, z: result[5]! },
          point: { x: result[6]!, y: result[7]!, z: result[8]! },
        };
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] castRay() not available in local mode');
      }
      return null;
    },

    castShape(
      pos: Physics3DVec3,
      rot: Physics3DQuat,
      dir: Physics3DVec3,
      shape: Physics3DColliderShape,
      maxDist: number,
      opts: { layers?: number; mask?: number } = {},
    ): ShapeHit | null {
      if (backendMode === 'wasm') {
        const { layers = 0xffffffff, mask = 0xffffffff } = opts;
        const [shapeType, p0, p1, p2] = encodeShape(shape);
        const result = wasmBridge!.physics3d_cast_shape?.(
          pos.x,
          pos.y,
          pos.z,
          rot.x,
          rot.y,
          rot.z,
          rot.w,
          dir.x,
          dir.y,
          dir.z,
          shapeType,
          p0,
          p1,
          p2,
          maxDist,
          layers,
          mask,
        );
        // 15-float result: [hit, entity, toi, nx, ny, nz, px, py, pz, waAx, waAy, waAz, waBx, waBy, waBz]
        if (!result || result.length < 15 || result[0] === 0) return null;
        const entityIndex = result[1] as number;
        return {
          entity: entityIndexToId(entityIndex),
          distance: result[2]!,
          normal: { x: result[3]!, y: result[4]!, z: result[5]! },
          point: { x: result[6]!, y: result[7]!, z: result[8]! },
          witnessA: { x: result[9]!, y: result[10]!, z: result[11]! },
          witnessB: { x: result[12]!, y: result[13]!, z: result[14]! },
        };
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] castShape() not available in local mode');
      }
      return null;
    },

    overlapShape(
      pos: Physics3DVec3,
      rot: Physics3DQuat,
      shape: Physics3DColliderShape,
      opts: { layers?: number; mask?: number; maxResults?: number } = {},
    ): EntityId[] {
      if (backendMode === 'wasm') {
        const {
          layers = 0xffffffff,
          mask = 0xffffffff,
          maxResults = MAX_COMPOSABLE_OVERLAP_RESULTS,
        } = opts;
        const wasmMem = bridgeRuntime?.getLinearMemory?.();
        if (!wasmMem || !overlapScratchView || overlapScratchPtr === 0) {
          if (import.meta.env.DEV) {
            console.warn('[GWEN:physics3d] overlapShape() scratch buffer unavailable');
          }
          return [];
        }
        const [shapeType, p0, p1, p2] = encodeShape(shape);
        const safeMax = Math.min(maxResults, MAX_COMPOSABLE_OVERLAP_RESULTS);

        // Re-create view in case WASM memory grew
        const scratchView = new Uint32Array(
          wasmMem.buffer,
          overlapScratchPtr,
          MAX_COMPOSABLE_OVERLAP_RESULTS,
        );
        const count =
          wasmBridge!.physics3d_overlap_shape?.(
            pos.x,
            pos.y,
            pos.z,
            rot.x,
            rot.y,
            rot.z,
            rot.w,
            shapeType,
            p0,
            p1,
            p2,
            layers,
            mask,
            overlapScratchPtr,
            safeMax,
          ) ?? 0;

        const entities: EntityId[] = [];
        for (let i = 0; i < count; i++) {
          entities.push(entityIndexToId(scratchView[i]!));
        }
        return entities;
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] overlapShape() not available in local mode');
      }
      return [];
    },

    projectPoint(
      point: Physics3DVec3,
      opts: { layers?: number; mask?: number; solid?: boolean } = {},
    ): PointProjection | null {
      if (backendMode === 'wasm') {
        const { layers = 0xffffffff, mask = 0xffffffff, solid = true } = opts;
        const result = wasmBridge!.physics3d_project_point?.(
          point.x,
          point.y,
          point.z,
          layers,
          mask,
          solid ? 1 : 0,
        );
        // 6-float result: [hit, entity, projX, projY, projZ, isInside]
        if (!result || result.length < 6 || result[0] === 0) return null;
        const entityIndex = result[1] as number;
        return {
          entity: entityIndexToId(entityIndex),
          point: { x: result[2]!, y: result[3]!, z: result[4]! },
          isInside: result[5] !== 0,
        };
      }
      if (import.meta.env.DEV) {
        console.warn('[GWEN:physics3d] projectPoint() not available in local mode');
      }
      return null;
    },

    // ─── RFC-09: Character Controller ────────────────────────────────────────

    addCharacterController(
      entityId: EntityId,
      opts: CharacterControllerOpts = {},
    ): CharacterControllerHandle {
      const {
        stepHeight = 0.35,
        slopeLimit = 45,
        skinWidth = 0.02,
        snapToGround = 0.2,
        slideOnSteepSlopes = true,
        applyImpulsesToDynamic = true,
      } = opts;

      const entityIndex = toEntityIndex(entityId);

      if (backendMode === 'wasm') {
        const slotIndex =
          wasmBridge?.physics3d_add_character_controller?.(
            entityIndex,
            stepHeight,
            slopeLimit,
            skinWidth,
            snapToGround,
            slideOnSteepSlopes,
            applyImpulsesToDynamic,
          ) ?? 0xffffffff;

        if (slotIndex === 0xffffffff) {
          if (import.meta.env.DEV) {
            console.warn(
              '[GWEN:physics3d] addCharacterController: CC pool exhausted (max 32 controllers)',
            );
          }
          return createInertCharacterControllerHandle();
        }
        ccRegistrations.set(entityIndex, { slotIndex, entityIndex });

        const descBuf = ccDescriptorBuffer;

        let lastTranslation: Physics3DVec3 = { x: 0, y: 0, z: 0 };
        // Per-move result state (updated from CC SAB buffer reads)
        let _grounded = false;
        let _groundNormal: Physics3DVec3 | null = null;
        let _groundEntity: EntityId | null = null;

        const handle: CharacterControllerHandle = {
          get isGrounded() {
            return _grounded;
          },
          get groundNormal() {
            return _groundNormal;
          },
          get groundEntity() {
            return _groundEntity;
          },
          get lastTranslation() {
            return lastTranslation;
          },
          move(desiredVelocity: Physics3DVec3, dt: number) {
            // Write to descriptor buffer for next-frame bulk move
            // perf: replaced [...spread].findIndex() with manual for...of loop to avoid array allocation every frame
            let myDescSlot = -1;
            let _ccSlotIdx = 0;
            for (const _ccEntry of ccRegistrations.values()) {
              if (_ccEntry.entityIndex === entityIndex) {
                myDescSlot = _ccSlotIdx;
                break;
              }
              _ccSlotIdx++;
            }
            if (descBuf.view && myDescSlot >= 0) {
              const di = myDescSlot * 4;
              // Store entity index as bit-cast u32 in the f32 buffer slot
              const tmp = new DataView(descBuf.view.buffer, descBuf.view.byteOffset + di * 4, 4);
              tmp.setUint32(0, entityIndex, true);
              descBuf.view[di + 1] = desiredVelocity.x;
              descBuf.view[di + 2] = desiredVelocity.y;
              descBuf.view[di + 3] = desiredVelocity.z;
            }
            // Drive the character controller — results are written to CC_STATE_BUFFER (void return)
            wasmBridge?.physics3d_character_controller_move?.(
              entityIndex,
              desiredVelocity.x,
              desiredVelocity.y,
              desiredVelocity.z,
              dt,
            );
            // Read result from SAB (populated after WASM init)
            const view = ccSABView.view;
            if (view !== null) {
              const base = slotIndex * CC_STATE_STRIDE;
              _grounded = view[base] !== 0;
              _groundNormal = _grounded
                ? { x: view[base + 1]!, y: view[base + 2]!, z: view[base + 3]! }
                : null;
              const groundBits = view[base + 4]!;
              _castF32[0] = groundBits;
              const groundIdx = _castU32[0]!;
              _groundEntity =
                _grounded && groundIdx !== 0xffffffff && groundIdx !== 0xfffffffe
                  ? entityIndexToId(groundIdx)
                  : null;
            } else {
              _grounded = false;
              _groundNormal = null;
              _groundEntity = null;
            }

            lastTranslation = {
              x: desiredVelocity.x * dt,
              y: desiredVelocity.y * dt,
              z: desiredVelocity.z * dt,
            };
          },
        };
        return handle;
      }

      // Local mode: return an inert handle with position-update fallback
      let lastTranslation: Physics3DVec3 = { x: 0, y: 0, z: 0 };
      return {
        get isGrounded() {
          return false;
        },
        get groundNormal() {
          return null;
        },
        get groundEntity() {
          return null;
        },
        get lastTranslation() {
          return lastTranslation;
        },
        move(v: Physics3DVec3, dt: number) {
          if (import.meta.env.DEV && !_emittedCCLocalWarning) {
            console.warn(
              '[GWEN:physics3d] CharacterController uses local fallback — step-up/slope not supported',
            );
            _emittedCCLocalWarning = true;
          }
          // Naive position integration via existing body state
          const state = stateByEntity.get(entityIndex);
          if (state) {
            state.position = {
              x: state.position.x + v.x * dt,
              y: state.position.y + v.y * dt,
              z: state.position.z + v.z * dt,
            };
          }
          lastTranslation = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
        },
      } satisfies CharacterControllerHandle;
    },

    removeCharacterController(entityId: EntityId): void {
      const entityIndex = toEntityIndex(entityId);
      ccRegistrations.delete(entityIndex);
      if (backendMode === 'wasm') {
        wasmBridge?.physics3d_remove_character_controller?.(entityIndex);
      }
    },

    // ─── RFC-07: Composable slot registration ────────────────────────────────

    registerRaycastSlot(opts: RaycastOpts, staticSlotIdx?: number): RaycastHandle {
      const id = staticSlotIdx ?? nextRaycastSlotId++;
      if (raycastSlots.size >= MAX_RAYCAST_SLOTS) {
        console.warn(`[GWEN:physics3d] Maximum raycast slot count (${MAX_RAYCAST_SLOTS}) reached`);
      }
      const result: RaycastSlotResult = {
        hit: false,
        entity: 0n as EntityId,
        distance: 0,
        normal: { x: 0, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
      };
      const handle: RaycastHandle = {
        get hit() {
          return result.hit;
        },
        get entity() {
          return result.entity;
        },
        get distance() {
          return result.distance;
        },
        get normal() {
          return result.normal;
        },
        get point() {
          return result.point;
        },
        _id: id,
      };
      raycastSlots.set(id, {
        opts,
        result,
        // Pre-compute static SAB inputs once at registration. These floats are written
        // via view.set(_si, base+3) each frame, avoiding per-frame nullish coalescing,
        // function calls, and _u32ToF32 invocations for direction/mask/layer/solid.
        _si: new Float32Array([
          opts.direction.x,
          opts.direction.y,
          opts.direction.z,
          opts.maxDist ?? 100,
          _u32ToF32(opts.layers ?? 0xffffffff),
          _u32ToF32(opts.mask ?? 0xffffffff),
          (opts.solid ?? true) ? 1.0 : 0.0,
        ]),
      });
      // Pre-register the slot with Rust so the output SAB pointer is set up.
      // Rust will write results to slotPtr after each step().
      if (staticSlotIdx !== undefined && backendMode === 'wasm' && wasmBridge) {
        const slotPtr = _raycastOutputSABPtr + staticSlotIdx * 9 * 4;
        wasmBridge.physics3d_add_raycast_slot?.(
          slotPtr,
          0,
          0,
          0, // dummy origin — overwritten each frame via input SAB
          opts.direction.x,
          opts.direction.y,
          opts.direction.z,
          opts.maxDist ?? 100,
          opts.layers ?? 0xffffffff,
          opts.mask ?? 0xffffffff,
          opts.solid ?? true,
        );
      }
      return handle;
    },

    unregisterRaycastSlot(handle: RaycastHandle): void {
      raycastSlots.delete(handle._id);
    },

    registerShapeCastSlot(opts: ShapeCastOpts, staticSlotIdx?: number): ShapeCastHandle {
      const id = staticSlotIdx ?? nextShapeCastSlotId++;
      if (shapeCastSlots.size >= MAX_SHAPECAST_SLOTS) {
        console.warn(
          `[GWEN:physics3d] Maximum shape cast slot count (${MAX_SHAPECAST_SLOTS}) reached`,
        );
      }
      const result: ShapeCastSlotResult = {
        hit: false,
        entity: 0n as EntityId,
        distance: 0,
        normal: { x: 0, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
        witnessA: { x: 0, y: 0, z: 0 },
        witnessB: { x: 0, y: 0, z: 0 },
      };
      const handle: ShapeCastHandle = {
        get hit() {
          return result.hit;
        },
        get entity() {
          return result.entity;
        },
        get distance() {
          return result.distance;
        },
        get normal() {
          return result.normal;
        },
        get point() {
          return result.point;
        },
        get witnessA() {
          return result.witnessA;
        },
        get witnessB() {
          return result.witnessB;
        },
        _id: id,
      };
      shapeCastSlots.set(id, {
        opts,
        result,
        // Pre-compute static SAB inputs [dx,dy,dz,shape_type,p0,p1,p2,maxDist,layers_f32,mask_f32]
        _si: (() => {
          const [shapeType, p0, p1, p2] = encodeShape(opts.shape);
          return new Float32Array([
            opts.direction.x,
            opts.direction.y,
            opts.direction.z,
            shapeType,
            p0,
            p1,
            p2,
            opts.maxDist ?? 100,
            _u32ToF32(opts.layers ?? 0xffffffff),
            _u32ToF32(opts.mask ?? 0xffffffff),
          ]);
        })(),
      });
      // Pre-register the slot with Rust so the output SAB pointer is set up.
      if (staticSlotIdx !== undefined && backendMode === 'wasm' && wasmBridge) {
        const slotPtr = _shapecastOutputSABPtr + staticSlotIdx * 15 * 4;
        const origin = opts.origin?.() ?? ZERO_VEC3;
        const rotation = opts.rotation?.() ?? { x: 0, y: 0, z: 0, w: 1 };
        const [shapeType, p0, p1, p2] = encodeShape(opts.shape);
        wasmBridge.physics3d_add_shapecast_slot?.(
          slotPtr,
          shapeType,
          p0,
          p1,
          p2,
          origin.x,
          origin.y,
          origin.z,
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
          opts.direction.x,
          opts.direction.y,
          opts.direction.z,
          opts.maxDist ?? 100,
          opts.layers ?? 0xffffffff,
          opts.mask ?? 0xffffffff,
        );
      }
      return handle;
    },

    unregisterShapeCastSlot(handle: ShapeCastHandle): void {
      shapeCastSlots.delete(handle._id);
    },

    registerOverlapSlot(opts: OverlapOpts, staticSlotIdx?: number): OverlapHandle {
      const id = staticSlotIdx ?? nextOverlapSlotId++;
      if (overlapSlots.size >= MAX_OVERLAP_SLOTS) {
        console.warn(`[GWEN:physics3d] Maximum overlap slot count (${MAX_OVERLAP_SLOTS}) reached`);
      }
      const result: OverlapSlotResult = { count: 0, entities: [] };
      const handle: OverlapHandle = {
        get count() {
          return result.count;
        },
        get entities() {
          return result.entities;
        },
        _id: id,
      };
      overlapSlots.set(id, {
        opts,
        result,
        // Pre-compute static SAB inputs [shape_type,p0,p1,p2,maxResults_f32]
        _si: (() => {
          const [shapeType, p0, p1, p2] = encodeShape(opts.shape);
          return new Float32Array([
            shapeType,
            p0,
            p1,
            p2,
            opts.maxResults ?? MAX_COMPOSABLE_OVERLAP_RESULTS,
          ]);
        })(),
      });
      // Pre-register the slot with Rust so the per-slot output buffer pointer is set up.
      if (staticSlotIdx !== undefined && backendMode === 'wasm' && wasmBridge) {
        const ovStride = MAX_COMPOSABLE_OVERLAP_RESULTS + 1;
        const slotPtr = _overlapOutputSABPtr + staticSlotIdx * ovStride * 4;
        const origin = opts.origin();
        const rotation = opts.rotation?.() ?? { x: 0, y: 0, z: 0, w: 1 };
        const [shapeType, p0, p1, p2] = encodeShape(opts.shape);
        wasmBridge.physics3d_add_overlap_slot?.(
          slotPtr,
          shapeType,
          p0,
          p1,
          p2,
          origin.x,
          origin.y,
          origin.z,
          rotation.x,
          rotation.y,
          rotation.z,
          rotation.w,
          opts.layers ?? 0xffffffff,
          opts.mask ?? 0xffffffff,
          opts.maxResults ?? MAX_COMPOSABLE_OVERLAP_RESULTS,
        );
      }
      return handle;
    },

    unregisterOverlapSlot(handle: OverlapHandle): void {
      overlapSlots.delete(handle._id);
    },
  };

  // ─── Plugin lifecycle ─────────────────────────────────────────────────────────

  return {
    name: '@gwenjs/physics3d',

    setup(engine: GwenEngine): void {
      _engine = engine;
      const bridge = getWasmBridge() as unknown as Physics3DBridgeRuntime;
      _variant = bridge.variant;
      bridgeRuntime = bridge;

      if (_variant !== 'physics3d') {
        throw new Error(
          `[GWEN:Physics3D] Active core variant is "${_variant}". ` +
            'Use initWasm("physics3d") before starting the engine.',
        );
      }

      const pb = bridge.getPhysicsBridge();

      if (typeof pb.physics3d_init !== 'function') {
        throw new Error(
          '[GWEN:Physics3D] physics3d_init() is not available in current WASM exports.',
        );
      }

      pb.physics3d_init(cfg.gravity.x, cfg.gravity.y, cfg.gravity.z, cfg.maxEntities);

      if (typeof pb.physics3d_set_quality === 'function') {
        pb.physics3d_set_quality(QUALITY_PRESETS[cfg.qualityPreset]);
      }

      if (typeof pb.physics3d_set_event_coalescing === 'function') {
        pb.physics3d_set_event_coalescing(cfg.coalesceEvents ? 1 : 0);
      }

      stepFn = typeof pb.physics3d_step === 'function' ? pb.physics3d_step.bind(pb) : null;

      // Detect WASM backend: if physics3d_add_body is exported, delegate to Rapier3D
      if (typeof pb.physics3d_add_body === 'function') {
        backendMode = 'wasm';
        wasmBridge = pb;

        // Populate CC SAB view from WASM linear memory
        const ccSabPtr = pb.physics3d_get_cc_sab_ptr?.() ?? 0;
        const maxCC = pb.physics3d_get_max_cc_entities?.() ?? 32;
        if (ccSabPtr > 0) {
          const mem = bridgeRuntime?.getLinearMemory?.() ?? null;
          if (mem) {
            ccSABView.view = new Float32Array(mem.buffer, ccSabPtr, maxCC * CC_STATE_STRIDE);
          }
        }
      }

      ready = true;

      // Register prefab extension handler
      engine.hooks.hook('prefab:instantiate', (entityId, extensions) => {
        const ext = (extensions as Record<string, unknown>)?.physics3d as
          | Physics3DPrefabExtension
          | undefined;
        if (!ext?.body) return;

        const eid = entityId as Physics3DEntityId;
        createBody(eid, ext.body);

        if (ext.onCollision) {
          const slot =
            typeof eid === 'bigint'
              ? unpackEntityId(eid as EntityId).index
              : typeof eid === 'number'
                ? eid
                : parseInt(String(eid), 10);
          entityCollisionCallbacks.set(slot, ext.onCollision);
        }
      });

      offEntityDestroyed = engine.hooks.hook('entity:destroy', (entityId: EntityId) => {
        if (
          typeof entityId === 'bigint' ||
          typeof entityId === 'number' ||
          typeof entityId === 'string'
        ) {
          const eid = entityId as Physics3DEntityId;
          const slot =
            typeof eid === 'bigint'
              ? Number((eid as bigint) & 0xffffffffn)
              : typeof eid === 'number'
                ? eid
                : parseInt(String(eid), 10);
          entityCollisionCallbacks.delete(slot);
          removeBody(eid);
          // Clean up all sensor states for this entity in O(1)
          localSensorStates.delete(slot);
        }
      });

      engine.provide('physics3d', service);

      if (cfg.debug) {
        console.log(
          `[GWEN:Physics3D] Initialized. Backend=${backendMode} quality=${cfg.qualityPreset}`,
        );
      }
    },

    onBeforeUpdate(deltaTime: number): void {
      if (!ready || !stepFn) return;
      if (!(deltaTime > 0)) return;
      stepFn(deltaTime);
      if (backendMode === 'local') {
        advanceLocalState(deltaTime);
      }
    },

    onUpdate(): void {
      if (!ready || !_engine) return;

      // Invalidate DataView if memory buffer changed (memory.grow event)
      if (eventsView && backendMode === 'wasm') {
        const memory = bridgeRuntime?.getLinearMemory?.() ?? wasmBridge?.memory ?? null;
        if (memory && eventsBufferRef !== memory.buffer) {
          eventsView = null;
          eventsBufferRef = null;
        }
      }

      // Re-validate CC SAB view after WASM memory.grow
      if (ccSABView.view !== null && backendMode === 'wasm') {
        const mem = bridgeRuntime?.getLinearMemory?.() ?? null;
        if (mem !== null && ccSABView.view.buffer !== mem.buffer) {
          const ccSabPtr2 = wasmBridge!.physics3d_get_cc_sab_ptr?.() ?? 0;
          const maxCC2 = wasmBridge!.physics3d_get_max_cc_entities?.() ?? 32;
          if (ccSabPtr2 > 0) {
            ccSABView.view = new Float32Array(mem.buffer, ccSabPtr2, maxCC2 * CC_STATE_STRIDE);
          } else {
            ccSABView.view = null;
          }
        }
      }

      // Read events from WASM, or run local AABB collision detection
      const rawEvents =
        backendMode === 'wasm' ? readWasmCollisionEvents() : detectLocalCollisions();

      // Build resolved contacts — in local mode entity ids are slot bigints
      const contacts: Physics3DCollisionContact[] = rawEvents.map((ev) => {
        let entityA: EntityId;
        let entityB: EntityId;
        if (backendMode === 'wasm') {
          const genA = bridgeRuntime?.getEntityGeneration?.(ev.slotA);
          const genB = bridgeRuntime?.getEntityGeneration?.(ev.slotB);
          entityA =
            genA !== undefined ? createEntityId(ev.slotA, genA) : (BigInt(ev.slotA) as EntityId);
          entityB =
            genB !== undefined ? createEntityId(ev.slotB, genB) : (BigInt(ev.slotB) as EntityId);
        } else {
          // Fallback: use slot index directly as EntityId bigint
          entityA = BigInt(ev.slotA) as EntityId;
          entityB = BigInt(ev.slotB) as EntityId;
        }
        return {
          entityA,
          entityB,
          ...(ev.aColliderId !== undefined ? { aColliderId: ev.aColliderId } : {}),
          ...(ev.bColliderId !== undefined ? { bColliderId: ev.bColliderId } : {}),
          started: ev.started,
        };
      });

      currentFrameContacts = contacts;

      // Track event count for metrics (includes local AABB events in fallback mode)
      if (backendMode === 'local') lastFrameEventCount = rawEvents.length;

      if (contacts.length === 0) return;

      // Dispatch hook
      void _engine.hooks.callHook('physics3d:collision', contacts);

      // Dispatch to composable onContact() callbacks
      for (const contact of contacts) {
        _dispatchContactEvent(contact);
      }

      // Update sensor states and dispatch sensor:changed hook
      for (const ev of rawEvents) {
        for (const { slot, colliderId } of [
          { slot: ev.slotA, colliderId: ev.aColliderId },
          { slot: ev.slotB, colliderId: ev.bColliderId },
        ]) {
          if (colliderId === undefined) continue;

          // Resolve the EntityId: in WASM mode use generation-aware packing;
          // in local mode the slot IS the entity id (no generation).
          let eid: EntityId;
          if (backendMode === 'wasm') {
            const generation = bridgeRuntime?.getEntityGeneration?.(slot);
            if (generation === undefined) continue;
            eid = createEntityId(slot, generation);
          } else {
            eid = BigInt(slot) as EntityId;
          }

          const entitySlot = slot;
          let sensorMap = localSensorStates.get(entitySlot);
          if (!sensorMap) {
            sensorMap = new Map();
            localSensorStates.set(entitySlot, sensorMap);
          }
          const prev = sensorMap.get(colliderId) ?? { contactCount: 0, isActive: false };
          const newCount = ev.started ? prev.contactCount + 1 : Math.max(0, prev.contactCount - 1);
          const newActive = newCount > 0;
          const next: Physics3DSensorState = { contactCount: newCount, isActive: newActive };
          sensorMap.set(colliderId, next);

          if (prev.isActive !== newActive) {
            void _engine.hooks.callHook('physics3d:sensor:changed', eid, colliderId, next);
            if (newActive) {
              _dispatchSensorEnter(colliderId, eid as unknown as bigint);
            } else {
              _dispatchSensorExit(colliderId, eid as unknown as bigint);
            }
          }
        }
      }

      // Dispatch per-entity collision callbacks
      for (const contact of contacts) {
        const slotA = unpackEntityId(contact.entityA).index;
        const slotB = unpackEntityId(contact.entityB).index;
        entityCollisionCallbacks.get(slotA)?.(contact.entityA, contact.entityB, contact);
        entityCollisionCallbacks.get(slotB)?.(contact.entityB, contact.entityA, contact);
      }
    },

    teardown(): void {
      if (offEntityDestroyed) {
        offEntityDestroyed();
        offEntityDestroyed = null;
      }
      ready = false;
      _clearContactCallbacks();
      _clearSensorCallbacks();
      stepFn = null;
      backendMode = 'local';
      wasmBridge = null;
      bridgeRuntime = null;
      _engine = null;
      eventsView = null;
      eventsBufferRef = null;
      bodyByEntity.clear();
      stateByEntity.clear();
      localColliders.clear();
      localSensorStates.clear();
      entityCollisionCallbacks.clear();
      currentFrameContacts = [];
      lastFrameEventCount = 0;
      pooledEvents.length = 0;
      previousLocalContactKeys.clear();
    },
  };
});
