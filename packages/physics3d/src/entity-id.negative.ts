import type { Physics3DAPI } from "./types";

/**
 * Typecheck fails if `createBody` accepts a number or a string again.
 * The function is never called.
 */
function rejectWideEntityId(api: Physics3DAPI): void {
  // @ts-expect-error number is not an EntityId
  api.createBody(1);
  // @ts-expect-error string is not an EntityId
  api.createBody("1");
}

void rejectWideEntityId;
