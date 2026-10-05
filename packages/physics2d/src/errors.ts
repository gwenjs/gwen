import type { EntityId } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";

/** Error codes emitted by the GWEN Physics2D plugin. */
export const Physics2DErrorCodes = {
  /** Entity id is not alive. */
  STALE_ENTITY: "PHYSICS2D:STALE_ENTITY",
  /** bodyHandle is not registered to a live owner. */
  STALE_BODY_HANDLE: "PHYSICS2D:STALE_BODY_HANDLE",
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
