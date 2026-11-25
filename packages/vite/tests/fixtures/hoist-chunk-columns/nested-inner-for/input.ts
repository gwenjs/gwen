import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        for (let k = 0; k < 2; k++) {
          chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
        }
      }
      for (let j = 0; j < chunk.count; j++) {
        chunk.get(Velocity).vx[j] *= 0.5;
      }
    }
  });
});
