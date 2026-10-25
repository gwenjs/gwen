// packages/renderer-core/src/camera-types.ts
/**
 * @file Shared camera and viewport type contracts.
 *
 * The bodies live in `@gwenjs/schema`. This module re-exports the same types.
 * Consumed by camera-core, camera2d, camera3d, renderer-html, and renderer-webgl.
 */

export type {
  CameraProjection,
  CameraState,
  ViewportContext,
  ViewportRegion,
  WorldTransform,
} from "@gwenjs/schema";
