import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        const vx = chunk.get(Velocity).vx[i];
        const speed = Math.min(Math.sqrt(vx * vx), Math.PI);
        chunk.get(Position).x[i] += speed * dt;
      }
    }
  });
});
