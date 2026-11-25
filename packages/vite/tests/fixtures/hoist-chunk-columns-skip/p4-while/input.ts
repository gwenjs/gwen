import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      let i = 0;
      while (i < chunk.count) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
        i++;
      }
    }
  });
});
