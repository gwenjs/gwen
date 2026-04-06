/**
 * @file useShape() — sets shared shape dimensions on the current actor entity.
 */
import { _getActorEntityId } from '@gwenjs/core/scene';
import type { EntityId } from '@gwenjs/core';
import { useEngine } from '@gwenjs/core';
import { ShapeComponent } from '../shape-component';

/**
 * Configuration options for {@link useShape}.
 */
export interface ShapeOptions {
  /** Width in world units. */
  w?: number;
  /** Height in world units. */
  h?: number;
  /** Radius in world units (used for circle/sphere/capsule shapes). */
  radius?: number;
  /** Depth in world units (used in 3D contexts). */
  depth?: number;
}

/**
 * Attaches shared shape dimensions to the current actor entity.
 *
 * These dimensions are automatically read by `useStaticBody()`, `useDynamicBody()`,
 * and renderer composables, so they only need to be specified once per actor.
 *
 * @param options - The shape dimensions to attach.
 * @returns {void}
 *
 * @example
 * ```typescript
 * const GroundActor = defineActor(GroundPrefab, () => {
 *   useShape({ w: 800, h: 32 })
 *   useStaticBody()                   // reads Shape → 800×32 collider
 *   useSprite({ texture: 'ground' }) // renderer also reads Shape
 * })
 * ```
 *
 * @since 1.0.0
 */
export function useShape(options: ShapeOptions): void {
  const engine = useEngine();
  const entityId = _getActorEntityId() as unknown as EntityId;
  engine.addComponent(entityId, ShapeComponent, {
    w: options.w ?? 0,
    h: options.h ?? 0,
    radius: options.radius ?? 0,
    depth: options.depth ?? 0,
  });
}
