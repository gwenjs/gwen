import { defineActor, definePrefab, useEntityId } from "@gwenjs/core/actor";
import { useService } from "@gwenjs/core/system";
import { useDynamicBody } from "@gwenjs/physics2d";

/** A falling body that declares no transform: the physics body alone owns its transform node. */
export const Crate = defineActor(definePrefab([]), () => {
  const canvas = useService("canvas2d");
  useDynamicBody();
  canvas.draw(useEntityId(), { w: 1, h: 1, color: "#8d6e63" });
});
