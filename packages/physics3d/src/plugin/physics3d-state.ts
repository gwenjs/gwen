/**
 * @fileoverview Physics3D plugin state interface.
 * Defines the mutable state variables used across plugin lifecycle hooks.
 */

import type { Physics3DWasmBridge, Physics3DBridgeRuntime } from './bridge';
import type { GwenEngine } from '@gwenjs/core';
import type {
  Physics3DBodyHandle,
  Physics3DBodyState,
  Physics3DColliderOptions,
  Physics3DSensorState,
  Physics3DPrefabExtension,
} from '../types';
import type { InternalCollisionEvent3D } from './bridge';

/**
 * Mutable plugin state variables. Captured in the plugin closure and updated
 * during lifecycle hooks (setup, onUpdate, teardown).
 *
 * This interface documents the complete set of state maintained by the plugin.
 */
export interface Physics3DPluginState {
  /** Plugin readiness flag — set to true after setup() completes. */
  ready: boolean;

  /** Current backend mode: 'wasm' (Rapier3D) or 'local' (TypeScript fallback). */
  backendMode: 'wasm' | 'local';

  /** The WASM physics3d bridge — non-null only in 'wasm' mode. */
  wasmBridge: Physics3DWasmBridge | null;

  /** Bridge runtime for memory access and entity generation lookup. */
  bridgeRuntime: Physics3DBridgeRuntime | null;

  /** Counter for generating unique body IDs; incremented on each body creation. */
  nextBodyId: number;

  /** Body metadata registry: entity slot → Physics3DBodyHandle. */
  bodyByEntity: Map<number, Physics3DBodyHandle>;

  /** Local simulation state (local mode only): entity slot → Physics3DBodyState. */
  stateByEntity: Map<number, Physics3DBodyState>;

  /** Collider registry (both modes): entity slot → collider options array. */
  localColliders: Map<number, Physics3DColliderOptions[]>;

  /** Pending async BVH loads: collider ID → { AbortController, ready Promise }. */
  pendingBvhLoads: Map<number, { ac: AbortController; ready: Promise<void> }>;

  /** Sensor state per entity: entity slot → (sensor ID → Physics3DSensorState). */
  localSensorStates: Map<number, Map<number, Physics3DSensorState>>;

  /** Per-entity collision callbacks: entity slot → onCollision callback. */
  entityCollisionCallbacks: Map<number, NonNullable<Physics3DPrefabExtension['onCollision']>>;

  /** Current frame contacts — rebuilt each frame in onUpdate. */
  currentFrameContacts: Array<any>; // Avoid circular dependency, use any for collision contact type

  /** Track overlapping AABB pairs from previous frame (local mode only). */
  previousLocalContactKeys: Set<string>;

  /** WASM event buffer DataView — invalidated on memory.grow(). */
  eventsView: DataView | null;

  /** Reference to the ArrayBuffer backing eventsView — for invalidation detection. */
  eventsBufferRef: ArrayBuffer | null;

  /** Pooled internal event array — reused each frame to avoid GC pressure. */
  pooledEvents: InternalCollisionEvent3D[];

  /** Event count from the last processed frame. */
  lastFrameEventCount: number;

  /** Step function bound to the WASM bridge physics3d_step export (or null). */
  stepFn: ((delta: number) => void) | null;

  /** Cleanup handler for entity:destroy hook. */
  offEntityDestroyed: (() => void) | null;

  /** Stored GwenEngine reference — set in setup(), used by lifecycle hooks. */
  engine: GwenEngine | null;

  /** Core variant name (e.g., 'light', 'physics3d', 'physics2d'). */
  variant: 'light' | 'physics2d' | 'physics3d';
}
