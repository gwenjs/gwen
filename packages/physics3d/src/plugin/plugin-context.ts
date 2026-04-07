/**
 * @fileoverview Shared mutable state container for the Physics3D plugin.
 *
 * All sub-modules receive a reference to this context object, which holds the
 * Maps, Sets, and scalar flags that were previously local variables inside the
 * Physics3DPlugin closure. The context is created once per plugin instance.
 */

import type { GwenEngine, GwenLogger } from "@gwenjs/core";
import type {
  Physics3DBodyHandle,
  Physics3DBodyState,
  Physics3DColliderOptions,
  Physics3DSensorState,
  Physics3DPrefabExtension,
  Physics3DVec3,
  Pathfinding3DOptions,
  RaycastOpts,
  RaycastSlotResult,
  ShapeCastOpts,
  ShapeCastSlotResult,
  OverlapOpts,
  OverlapSlotResult,
  Physics3DCollisionContact,
} from "../types";
import type {
  InternalCollisionEvent3D,
  Physics3DWasmBridge,
  Physics3DBridgeRuntime,
} from "./bridge";

/** Layer registry type returned by `buildLayerRegistry`. */
export type LayerRegistry = ReturnType<typeof import("../config").buildLayerRegistry>;

/** Normalised config type returned by `normalizePhysics3DConfig`. */
export type NormalisedConfig = ReturnType<typeof import("../config").normalizePhysics3DConfig>;

/**
 * Shared mutable state for the Physics3D plugin.
 *
 * Fields are public so sub-modules can read/write them freely. This is an
 * intentional design choice — the context lives inside the plugin closure and
 * is never exposed to user code.
 */
export interface PluginContext {
  // ── Configuration ──────────────────────────────────────────────────────────
  cfg: NormalisedConfig;
  layerRegistry: LayerRegistry;

  // ── Plugin lifecycle flags ─────────────────────────────────────────────────
  ready: boolean;
  _variant: "light" | "physics2d" | "physics3d";
  stepFn: ((delta: number) => void) | null;
  offEntityDestroyed: (() => void) | null;
  nextBodyId: number;
  backendMode: "wasm" | "local";
  wasmBridge: Physics3DWasmBridge | null;
  bridgeRuntime: Physics3DBridgeRuntime | null;
  _engine: GwenEngine | null;
  log: GwenLogger;

  // ── Body registry ──────────────────────────────────────────────────────────
  bodyByEntity: Map<number, Physics3DBodyHandle>;
  stateByEntity: Map<number, Physics3DBodyState>;

  // ── Collider registry ──────────────────────────────────────────────────────
  localColliders: Map<number, Physics3DColliderOptions[]>;
  _pendingBvhLoads: Map<number, { ac: AbortController; ready: Promise<void> }>;

  // ── Sensor state ───────────────────────────────────────────────────────────
  localSensorStates: Map<number, Map<number, Physics3DSensorState>>;

  // ── Collision callbacks ────────────────────────────────────────────────────
  entityCollisionCallbacks: Map<number, NonNullable<Physics3DPrefabExtension["onCollision"]>>;

  // ── Frame contacts ─────────────────────────────────────────────────────────
  currentFrameContacts: Physics3DCollisionContact[];
  previousLocalContactKeys: Set<string>;

  // ── WASM event buffer ──────────────────────────────────────────────────────
  eventsView: DataView | null;
  eventsBufferRef: ArrayBuffer | null;
  pooledEvents: InternalCollisionEvent3D[];
  lastFrameEventCount: number;

  // ── Local simulation state ─────────────────────────────────────────────────
  localForces: Map<number, { x: number; y: number; z: number }>;
  localTorques: Map<number, { x: number; y: number; z: number }>;
  localAxisLocks: Map<
    number,
    { tx: boolean; ty: boolean; tz: boolean; rx: boolean; ry: boolean; rz: boolean }
  >;
  localSleeping: Set<number>;
  localGravityScales: Map<number, number>;

  // ── Character Controller ───────────────────────────────────────────────────
  ccRegistrations: Map<number, { slotIndex: number; entityIndex: number }>;
  ccSABView: { view: Float32Array | null };
  ccDescriptorBuffer: { view: Float32Array | null };
  _emittedCCLocalWarning: boolean;

  // ── Raycast slots ──────────────────────────────────────────────────────────
  nextRaycastSlotId: number;
  raycastSlots: Map<number, { opts: RaycastOpts; result: RaycastSlotResult; _si: Float32Array }>;
  _raycastOutputSABPtr: number;

  // ── Shape-cast slots ───────────────────────────────────────────────────────
  nextShapeCastSlotId: number;
  shapeCastSlots: Map<
    number,
    { opts: ShapeCastOpts; result: ShapeCastSlotResult; _si: Float32Array }
  >;
  _shapecastOutputSABPtr: number;

  // ── Overlap slots ──────────────────────────────────────────────────────────
  nextOverlapSlotId: number;
  overlapSlots: Map<number, { opts: OverlapOpts; result: OverlapSlotResult; _si: Float32Array }>;
  _overlapOutputSABPtr: number;
  overlapScratchView: DataView | null;
  overlapScratchPtr: number;

  // ── Pathfinding ────────────────────────────────────────────────────────────
  _localNavGrid: Pathfinding3DOptions | null;

  // ── Shared constants / scratch buffers ─────────────────────────────────────
  ZERO_VEC3: Physics3DVec3;
  _castU32: Uint32Array;
  _castF32: Float32Array;
  _slotsBuffer: number[];

  // ── Constants ──────────────────────────────────────────────────────────────
  readonly MAX_RAYCAST_SLOTS: number;
  readonly CC_STATE_STRIDE: number;
  readonly MAX_SHAPECAST_SLOTS: number;
  readonly MAX_OVERLAP_SLOTS: number;
  readonly MAX_COMPOSABLE_OVERLAP_RESULTS: number;
}

/**
 * Create a fresh {@link PluginContext} with the given normalised config.
 */
export function createPluginContext(
  cfg: NormalisedConfig,
  layerRegistry: LayerRegistry,
): PluginContext {
  const _castU32 = new Uint32Array(1);
  const _castF32 = new Float32Array(_castU32.buffer);

  return {
    cfg,
    layerRegistry,

    ready: false,
    _variant: "light",
    stepFn: null,
    offEntityDestroyed: null,
    nextBodyId: 1,
    backendMode: "local",
    wasmBridge: null,
    bridgeRuntime: null,
    _engine: null,
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child() { return this; }, setSink: () => {} } as GwenLogger,

    bodyByEntity: new Map(),
    stateByEntity: new Map(),

    localColliders: new Map(),
    _pendingBvhLoads: new Map(),

    localSensorStates: new Map(),

    entityCollisionCallbacks: new Map(),

    currentFrameContacts: [],
    previousLocalContactKeys: new Set(),

    eventsView: null,
    eventsBufferRef: null,
    pooledEvents: [],
    lastFrameEventCount: 0,

    localForces: new Map(),
    localTorques: new Map(),
    localAxisLocks: new Map(),
    localSleeping: new Set(),
    localGravityScales: new Map(),

    ccRegistrations: new Map(),
    ccSABView: { view: null },
    ccDescriptorBuffer: { view: null },
    _emittedCCLocalWarning: false,

    nextRaycastSlotId: 0,
    raycastSlots: new Map(),
    _raycastOutputSABPtr: 0,

    nextShapeCastSlotId: 0,
    shapeCastSlots: new Map(),
    _shapecastOutputSABPtr: 0,

    nextOverlapSlotId: 0,
    overlapSlots: new Map(),
    _overlapOutputSABPtr: 0,
    overlapScratchView: null,
    overlapScratchPtr: 0,

    _localNavGrid: null,

    ZERO_VEC3: { x: 0, y: 0, z: 0 },
    _castU32,
    _castF32,
    _slotsBuffer: [],

    MAX_RAYCAST_SLOTS: 64,
    CC_STATE_STRIDE: 5,
    MAX_SHAPECAST_SLOTS: 64,
    MAX_OVERLAP_SLOTS: 64,
    MAX_COMPOSABLE_OVERLAP_RESULTS: 16,
  };
}
