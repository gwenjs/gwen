/** Error codes emitted by the GWEN Physics3D plugin. */
export const Physics3DErrorCodes = {
  BVH_WORKER_TIMEOUT: "PHYSICS3D:BVH_WORKER_TIMEOUT",
  BVH_CALLBACK_HANG: "PHYSICS3D:BVH_CALLBACK_HANG",
  MESH_FALLBACK: "PHYSICS3D:MESH_FALLBACK",
  CONVEX_FALLBACK: "PHYSICS3D:CONVEX_FALLBACK",
  /** Entity id is not alive. */
  STALE_ENTITY: "PHYSICS3D:STALE_ENTITY",
  UNKNOWN_LAYER: "PHYSICS3D:UNKNOWN_LAYER",
  INVALID_COMPOUND: "PHYSICS3D:INVALID_COMPOUND",
  BVH_LOAD_FAILED: "PHYSICS3D:BVH_LOAD_FAILED",
  NOT_INITIALIZED: "PHYSICS3D:NOT_INITIALIZED",
  WASM_VARIANT_MISMATCH: "PHYSICS3D:WASM_VARIANT_MISMATCH",
  INVALID_MESH_BUFFER: "PHYSICS3D:INVALID_MESH_BUFFER",
  /**
   * The TypeScript registry has no rigid body for the entity.
   * Raised on the TypeScript side before any WASM call.
   * Compare `BODY_NOT_FOUND`, which a WASM export raises after the call.
   */
  NO_RIGID_BODY: "PHYSICS3D:NO_RIGID_BODY",
  MESH_REBUILD_FAILED: "PHYSICS3D:MESH_REBUILD_FAILED",
  /**
   * A WASM export found no rigid body registered for the slot.
   * Raised by Rust, after the call reached WASM.
   * Compare `NO_RIGID_BODY`, the TypeScript registry miss that never calls WASM.
   */
  BODY_NOT_FOUND: "PHYSICS3D:BODY_NOT_FOUND",
  /** The slot already has a rigid body. */
  BODY_ALREADY_EXISTS: "PHYSICS3D:BODY_ALREADY_EXISTS",
  /** Body kind is not 0, 1, or 2. */
  INVALID_BODY_KIND: "PHYSICS3D:INVALID_BODY_KIND",
  /** Parallel slices of a bulk call differ in length. */
  BUFFER_LENGTH_MISMATCH: "PHYSICS3D:BUFFER_LENGTH_MISMATCH",
  /** No collider is registered for the slot and collider id. */
  COLLIDER_NOT_FOUND: "PHYSICS3D:COLLIDER_NOT_FOUND",
  /** An add-collider export refused an id that is already registered for the slot. */
  COLLIDER_ALREADY_EXISTS: "PHYSICS3D:COLLIDER_ALREADY_EXISTS",
  /** Shape data cannot build a collider (heightfield size, mesh index, convex points). */
  INVALID_SHAPE: "PHYSICS3D:INVALID_SHAPE",
  /** No joint is registered for the joint id. */
  JOINT_NOT_FOUND: "PHYSICS3D:JOINT_NOT_FOUND",
  /** No character controller is registered for the slot. */
  CHARACTER_CONTROLLER_NOT_FOUND: "PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND",
  /** The character controller pool is full. */
  CHARACTER_CONTROLLER_LIMIT_REACHED: "PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED",
  /** A path query ran before the navigation grid was uploaded. */
  NAVGRID_NOT_INITIALIZED: "PHYSICS3D:NAVGRID_NOT_INITIALIZED",
  /** Navigation grid dimensions are zero, overflow, or exceed the cell limit. */
  INVALID_NAVGRID: "PHYSICS3D:INVALID_NAVGRID",
  /** A collider size, radius or other float is not accepted by the physics engine. */
  INVALID_COLLIDER: "PHYSICS3D:INVALID_COLLIDER",
} as const;

/** Type of a Physics3D error code string. */
export type Physics3DErrorCode = (typeof Physics3DErrorCodes)[keyof typeof Physics3DErrorCodes];
