import { defineActor } from "@gwenjs/core/actor";
import { onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const prefab = { name: "mover" };

export const Mover = defineActor("Mover", prefab, () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
    }
  });
});
