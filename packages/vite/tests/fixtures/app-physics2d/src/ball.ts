import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { useDynamicBody } from "@gwenjs/physics2d";

export const Ball = defineActor(definePrefab([]), () => {
  useDynamicBody({ gravityScale: 1 });
});
