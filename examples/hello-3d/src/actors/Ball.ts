import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { useDynamicBody, useSphereCollider } from "@gwenjs/physics3d";

export const Ball = defineActor(definePrefab([]), () => {
  useDynamicBody({ gravityScale: 1 });
  useSphereCollider({ radius: 0.5 });
});
