/**
 * @file 2D and 3D transform reader contracts.
 *
 * Types, plus the service keys. The core engine provides both readers.
 * This module has no `@gwenjs/*` dependency.
 *
 * @module
 */

import type { EntityId } from "./entity.js";

/** Service key of the 2D transform reader. Engine-owned: provided by every core engine. */
export const TRANSFORM_2D_SERVICE = "transform:2d" as const;

/** Caller-owned. `read` writes every field and allocates nothing. */
export interface TransformSample2D {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
}

declare const transformRef2D: unique symbol;

/** Opaque. Obtained once from `track`, reused every frame. Never a slot index. */
export interface TransformRef2D {
  readonly [transformRef2D]: true;
}

export interface TransformReader2D {
  /**
   * Resolve `entity` once. Call it at spawn or follow time, never per frame.
   * Throws GwenError CORE:TRANSFORM_REF_INVALID (reason "dead-entity" | "engine-stopped").
   * Throws CORE:INVALID_ENTITY_ID for a non-bigint id (existing rule, entity.ts:61-62).
   */
  track(entity: EntityId): TransformRef2D;

  /** Idempotent. A released ref reads false. */
  release(ref: TransformRef2D): void;

  /**
   * Write the render pose of `ref` into `out`. Returns false (out untouched) when the ref is
   * released, its entity is destroyed, the entity has no transform, or the engine has stopped.
   * Throws CORE:TRANSFORM_REF_INVALID reason "foreign-engine" for a ref from another engine.
   * 0 allocations, 0 WASM calls.
   */
  read(ref: TransformRef2D, out: TransformSample2D): boolean;
}

/** Service key of the 3D transform reader. Engine-owned: provided by every core engine. */
export const TRANSFORM_3D_SERVICE = "transform:3d" as const;

/** Caller-owned. `read` writes every field and allocates nothing. */
export interface TransformSample3D {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

declare const transformRef3D: unique symbol;

/** Opaque. Obtained once from `track`, reused every frame. Never a slot index. */
export interface TransformRef3D {
  readonly [transformRef3D]: true;
}

export interface TransformReader3D {
  /**
   * Resolve `entity` once. Call it at spawn or follow time, never per frame.
   * Throws GwenError CORE:TRANSFORM_REF_INVALID (reason "dead-entity" | "engine-stopped").
   * Throws CORE:INVALID_ENTITY_ID for a non-bigint id (existing rule, entity.ts:65-67).
   */
  track(entity: EntityId): TransformRef3D;

  /** Idempotent. A released ref reads false. */
  release(ref: TransformRef3D): void;

  /**
   * Write the render pose of `ref` into `out`. Returns false (out untouched) when the ref is
   * released, its entity is destroyed, the entity has no 3D node, the history is not committed
   * yet, or the engine has stopped.
   * Throws CORE:TRANSFORM_REF_INVALID reason "foreign-engine" for a ref from another engine
   * or from another reader.
   * 0 allocations, 0 WASM calls.
   */
  read(ref: TransformRef3D, out: TransformSample3D): boolean;
}
