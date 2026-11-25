import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        const pos = chunk.get(Position);
        pos.x[i] += chunk.get(Velocity).vx[i] * dt;
        pos.y[i] += chunk.get(Velocity).vy[i] * dt;
      }
    }
  });
});
