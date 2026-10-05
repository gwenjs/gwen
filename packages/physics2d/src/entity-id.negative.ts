import type { Physics2DAPI } from "./types";

/**
 * Typecheck fails if `addRigidBody` accepts a number or a string again.
 * The function is never called.
 */
function rejectWideEntityId(api: Physics2DAPI): void {
  // @ts-expect-error number is not an EntityId
  api.addRigidBody(1, "dynamic", 0, 0);
  // @ts-expect-error string is not an EntityId
  api.addRigidBody("1", "dynamic", 0, 0);
}

void rejectWideEntityId;
