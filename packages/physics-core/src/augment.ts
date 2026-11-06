/**
 * Hook names owned by the shared physics layer.
 * Importing `@gwenjs/physics-core` merges them into `@gwenjs/schema`.
 */

import type { EntityId } from "@gwenjs/schema";
import type { CollisionContact, SensorState } from "./types.js";

export type { CollisionContact, SensorState };

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "physics:collision": (contacts: ReadonlyArray<CollisionContact>) => void;
    "physics:sensor:changed": (entityId: EntityId, sensorId: number, state: SensorState) => void;
  }
}
