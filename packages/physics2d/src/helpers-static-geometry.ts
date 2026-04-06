// Tree-shakable static geometry helpers entry.
export { buildStaticGeometryChunk, loadStaticGeometryChunk } from './helpers/static-geometry';
export {
  buildTilemapPhysicsChunks,
  patchTilemapPhysicsChunk,
  TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION,
} from './tilemap';
export type {
  BuildTilemapPhysicsChunksInput,
  PatchTilemapPhysicsChunkInput,
  TilemapChunkRect,
  TilemapPhysicsChunk,
  TilemapPhysicsChunkMap,
} from './types';
