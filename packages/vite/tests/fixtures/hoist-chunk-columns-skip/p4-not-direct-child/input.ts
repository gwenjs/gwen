import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      if (chunk.count > 0) {
        for (let i = 0; i < chunk.count; i++) {
          chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
        }
      }
    }
  });
});
