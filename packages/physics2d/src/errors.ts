import { GwenError, type EntityId } from "@gwenjs/schema";

/** Error codes emitted by the GWEN Physics2D plugin. */
export const Physics2DErrorCodes = {
  /** Entity id is not alive. */
  STALE_ENTITY: "PHYSICS2D:STALE_ENTITY",
  /** bodyHandle is not registered to a live owner. */
  STALE_BODY_HANDLE: "PHYSICS2D:STALE_BODY_HANDLE",
  INVALID_LAYERS: "PHYSICS2D:INVALID_LAYERS",
  UNKNOWN_LAYER: "PHYSICS2D:UNKNOWN_LAYER",
  INVALID_COLLIDER: "PHYSICS2D:INVALID_COLLIDER",
  WASM_VARIANT_MISMATCH: "PHYSICS2D:WASM_VARIANT_MISMATCH",
  INVALID_PREFAB_EXTENSION: "PHYSICS2D:INVALID_PREFAB_EXTENSION",
  /** Not in the #64 table. The site is newer than that list. */
  POSITION_COMPONENT_REQUIRED: "PHYSICS2D:POSITION_COMPONENT_REQUIRED",
  /** The export touched the world before physics_init. */
  NOT_INITIALIZED: "PHYSICS2D:NOT_INITIALIZED",
  /** No rigid body is registered for the slot. */
  BODY_NOT_FOUND: "PHYSICS2D:BODY_NOT_FOUND",
  /** The slot already has a rigid body. */
  BODY_ALREADY_EXISTS: "PHYSICS2D:BODY_ALREADY_EXISTS",
  /** Body kind is not 0, 1, or 2. */
  INVALID_BODY_KIND: "PHYSICS2D:INVALID_BODY_KIND",
  /** Parallel slices of a bulk call differ in length. */
  BUFFER_LENGTH_MISMATCH: "PHYSICS2D:BUFFER_LENGTH_MISMATCH",
  /** A tilemap chunk id is already loaded. */
  TILEMAP_CHUNK_ALREADY_LOADED: "PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED",
  /** A tilemap chunk id is not loaded. */
  TILEMAP_CHUNK_NOT_LOADED: "PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED",
  /** A path coordinate or distance is outside the accepted bounds. */
  INVALID_PATH_REQUEST: "PHYSICS2D:INVALID_PATH_REQUEST",
  /** A coordinate that is not finite or outside ±1e7, or a half-extent/radius that is not finite, negative, or above 1e7. */
  INVALID_QUERY: "PHYSICS2D:INVALID_QUERY",
  /** A step delta is not finite, or sits outside 0 to 1. */
  INVALID_STEP_DELTA: "PHYSICS2D:INVALID_STEP_DELTA",
} as const;

export type Physics2DErrorCode = (typeof Physics2DErrorCodes)[keyof typeof Physics2DErrorCodes];

/** Thrown when a Physics2D call targets an entity that is not alive. */
export class Physics2DStaleEntityError extends GwenError {
  readonly entityId: EntityId;
  readonly operation: string;

  constructor(entityId: EntityId, operation: string) {
    super(
      Physics2DErrorCodes.STALE_ENTITY,
      `[${Physics2DErrorCodes.STALE_ENTITY}] ${operation} rejected a stale entity`,
    );
    this.name = "Physics2DStaleEntityError";
    this.entityId = entityId;
    this.operation = operation;
  }
}

/** Thrown when a collider call uses a body handle that has no owner. */
export class Physics2DStaleBodyHandleError extends GwenError {
  readonly bodyHandle: number;
  readonly operation: "addBoxCollider" | "addBallCollider";

  constructor(bodyHandle: number, operation: "addBoxCollider" | "addBallCollider") {
    super(
      Physics2DErrorCodes.STALE_BODY_HANDLE,
      `[${Physics2DErrorCodes.STALE_BODY_HANDLE}] ${operation} rejected an unregistered body handle`,
    );
    this.name = "Physics2DStaleBodyHandleError";
    this.bodyHandle = bodyHandle;
    this.operation = operation;
  }
}
