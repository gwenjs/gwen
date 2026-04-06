/** Error codes emitted by the GWEN Physics3D plugin. */
export const Physics3DErrorCodes = {
  BVH_WORKER_TIMEOUT: 'PHYSICS3D:BVH_WORKER_TIMEOUT',
  BVH_CALLBACK_HANG: 'PHYSICS3D:BVH_CALLBACK_HANG',
  MESH_FALLBACK: 'PHYSICS3D:MESH_FALLBACK',
  CONVEX_FALLBACK: 'PHYSICS3D:CONVEX_FALLBACK',
} as const;

/** Type of a Physics3D error code string. */
export type Physics3DErrorCode = (typeof Physics3DErrorCodes)[keyof typeof Physics3DErrorCodes];
