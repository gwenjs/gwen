import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./system-iteration.components";

export const Mover = defineSystem("bench-system-iteration", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        const x = chunk.get(Position).x[i] ?? 0;
        const y = chunk.get(Position).y[i] ?? 0;
        chunk.get(Position).x[i] = x + (chunk.get(Velocity).vx[i] ?? 0) * dt;
        chunk.get(Position).y[i] = y + (chunk.get(Velocity).vy[i] ?? 0) * dt;
      }
    }
  });
});
