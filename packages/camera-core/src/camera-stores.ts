/**
 * Per-engine camera side stores.
 *
 * Strings and object graphs cannot live in SoA columns. Each engine owns its
 * own maps, so two engines can use the same entity id without sharing state.
 */

import { createEngineLocal } from "@gwenjs/core";
import type { EntityId, GwenEngine } from "@gwenjs/core";
import type { CameraPathData } from "./types.js";
import type { XRViewData } from "./xr-camera-handle";

export interface CameraStores {
  viewports: Map<EntityId, string>;
  paths: Map<EntityId, CameraPathData>;
  matrices: Map<EntityId, XRViewData[]>;
}

const stores = createEngineLocal<CameraStores>(() => ({
  viewports: new Map(),
  paths: new Map(),
  matrices: new Map(),
}));

/** The camera side stores owned by `engine`. Created on first access. */
export function getCameraStores(engine: GwenEngine): CameraStores {
  return stores.get(engine);
}
