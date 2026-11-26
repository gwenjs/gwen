import { defineActor, definePrefab, useEntityId } from "@gwenjs/core/actor";
import { useTransform } from "@gwenjs/core/actor";
import { useService } from "@gwenjs/core/system";
import { useBoxCollider } from "@gwenjs/physics2d";

export const Ground = defineActor(definePrefab([]), () => {
  useTransform();
  const canvas = useService("canvas2d");
  useBoxCollider({ w: 40, h: 1, offsetY: -1 });
  canvas.draw(useEntityId(), { w: 40, h: 1, color: "#455a64" });
});
