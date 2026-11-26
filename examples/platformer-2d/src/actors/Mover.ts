import { defineActor, definePrefab, useEntityId, useTransform } from "@gwenjs/core/actor";
import { onUpdate, useService } from "@gwenjs/core/system";

/** World units per second. At 40 pixels per unit this is 120 pixels per second. */
const SPEED = 3;

export const Mover = defineActor(definePrefab([]), () => {
  const transform = useTransform();
  const canvas = useService("canvas2d");
  transform.setPosition(-5, 3);
  canvas.draw(useEntityId(), { w: 1, h: 1, color: "#1e88e5" });
  onUpdate((dt) => {
    transform.translate(SPEED * dt, 0);
  });
});
