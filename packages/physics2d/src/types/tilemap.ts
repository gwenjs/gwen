/**
 * Tilemap physics chunk types.
 */

import type { EntityId } from '@gwenjs/core';
import type {
  PhysicsColliderShape,
  PhysicsMaterialPreset,
  PhysicsMaterialPresetName,
} from './materials';
import type { RigidBodyType, PhysicsGroundedRole } from './bodies';
import type { CollisionContact } from './events';

export const TILEMAP_PHYSICS_CHUNK_FORMAT_VERSION = 1;

export interface TilemapChunkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilemapPhysicsChunk {
  key: string;
  chunkX: number;
  chunkY: number;
  checksum: string;
  rects: ReadonlyArray<TilemapChunkRect>;
  colliders: ReadonlyArray<PhysicsColliderDef>;
}

export interface TilemapPhysicsChunkMap {
  formatVersion: number;
  mapWidthTiles: number;
  mapHeightTiles: number;
  chunkSizeTiles: number;
  tileSizePx: number;
  chunks: ReadonlyArray<TilemapPhysicsChunk>;
}

export interface BuildTilemapPhysicsChunksInput {
  tiles: ReadonlyArray<number>;
  mapWidthTiles: number;
  mapHeightTiles: number;
  chunkSizeTiles?: number;
  tileSizePx?: number;
  isSolidTile?: (tileValue: number, x: number, y: number) => boolean;
}

export interface PatchTilemapPhysicsChunkInput {
  source: BuildTilemapPhysicsChunksInput;
  chunkX: number;
  chunkY: number;
  previous: TilemapPhysicsChunkMap;
}

export interface Physics2DHelperContext {
  physics: any;
  pixelsPerMeter?: number;
}

export interface PhysicsEntitySnapshot {
  entityId: EntityId;
  position: { x: number; y: number; rotation: number } | null;
  velocity: { x: number; y: number } | null;
}

export type ResolvedCollisionContact = CollisionContact;

export interface TilemapChunkOrchestrator {
  syncVisibleChunks(chunks: ReadonlyArray<{ chunkX: number; chunkY: number }>): void;
  patchChunk(chunkX: number, chunkY: number, nextSource: BuildTilemapPhysicsChunksInput): void;
  dispose(): void;
}

export interface PhysicsColliderDef extends PhysicsMaterialPreset {
  id?: string;
  colliderId?: number;
  shape: PhysicsColliderShape;
  material?: PhysicsMaterialPresetName | PhysicsMaterialPreset;
  hw?: number;
  hh?: number;
  radius?: number;
  offsetX?: number;
  offsetY?: number;
  isSensor?: boolean;
  groundedRole?: PhysicsGroundedRole;
  membershipLayers?: string[] | number;
  filterLayers?: string[] | number;
}

export interface Physics2DPrefabExtension {
  bodyType?: RigidBodyType;
  material?: PhysicsMaterialPresetName | PhysicsMaterialPreset;
  ccdEnabled?: boolean;
  additionalSolverIterations?: number;
  colliders?: PhysicsColliderDef[];
  mass?: number;
  gravityScale?: number;
  linearDamping?: number;
  angularDamping?: number;
  initialVelocity?: { vx: number; vy: number };
  onCollision?: (self: EntityId, other: EntityId, contact: CollisionContact) => void;
}

export const PHYSICS2D_BRIDGE_SCHEMA_VERSION = 2;
export const PHYSICS2D_EVENTS_RING_FORMAT_VERSION = 2;
export const PHYSICS2D_WASM_EVENT_STRIDE = 16;
