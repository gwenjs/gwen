import type * as Root from "@gwenjs/physics-core";

/** Every public type. A missing export fails the typecheck of this file. */
export type PublicApiTypes = [
  Root.BodyKind,
  Root.BodyOptions,
  Root.BoxColliderOptions<"3d">,
  Root.CapsuleColliderOptions<"3d">,
  Root.ColliderFilterOptions,
  Root.CollisionContact,
  Root.CollisionEventLayout,
  Root.ContactRegistry,
  Root.Dim,
  Root.DimRot<"3d">,
  Root.DimVec<"2d">,
  Root.InternalCollisionEvent,
  Root.KinematicBodyOptions<"2d">,
  Root.LayerSelector,
  Root.PhysicsConfigBase<"2d">,
  Root.QualityPreset,
  Root.SensorRegistry,
  Root.SensorState,
  Root.SphereColliderOptions<"2d">,
];
