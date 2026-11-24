import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { useStaticBody } from "@gwenjs/physics3d";

export const Ground = defineActor(definePrefab([]), () => {
  useStaticBody();
});
