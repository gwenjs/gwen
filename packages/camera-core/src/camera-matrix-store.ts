// packages/camera-core/src/camera-matrix-store.ts
/**
 * @file cameraMatrixStore — per-eye view and projection matrices for XR cameras.
 *
 * Strings and Float32Arrays cannot be stored in SoA components. This Map is the
 * authoritative source for XR camera view data each frame.
 *
 * Lifecycle:
 * - `set` is called by `handle._setViews()` inside `useXRCamera`, once per frame.
 * - `delete` is called inside the `onCleanup()` registered by `useXRCamera`.
 * - The XR renderer plugin reads this map to build per-eye render passes.
 */

import type { EntityId } from "@gwenjs/core";
import type { XRViewData } from "./xr-camera-handle";

export const cameraMatrixStore = new Map<EntityId, XRViewData[]>();
