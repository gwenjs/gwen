/**
 * @file ShapeComponent — shared shape dimensions ECS component for @gwenjs/physics2d.
 */
import { defineComponent, Types } from '@gwenjs/core';

/**
 * Shared shape dimensions ECS component.
 *
 * Set by {@link useShape} and read automatically by `useStaticBody()`,
 * `useDynamicBody()`, and renderer composables so that dimensions only
 * need to be declared once per actor.
 *
 * @example
 * ```typescript
 * const GroundActor = defineActor(GroundPrefab, () => {
 *   useShape({ w: 800, h: 32 })
 *   useStaticBody()          // reads Shape → 800×32 collider
 * })
 * ```
 *
 * @since 1.0.0
 */
export const ShapeComponent = defineComponent({
  name: 'Shape',
  schema: {
    w: Types.f32,
    h: Types.f32,
    radius: Types.f32,
    depth: Types.f32,
  },
  defaults: {
    w: 0,
    h: 0,
    radius: 0,
    depth: 0,
  },
});

/** Inferred data type for {@link ShapeComponent}. */
export type ShapeData = { w: number; h: number; radius: number; depth: number };
