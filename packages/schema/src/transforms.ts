/**
 * @file 2D transform reader contract.
 *
 * Types, plus the service key. The core engine provides the reader.
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
