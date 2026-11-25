import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += (chunk.get(Velocity).vx[i] as number) * dt;
        chunk.get(Position).y[i] += chunk.get(Velocity)!.vy[i] * dt;
        const mix = (chunk.get(Position).x[i] + chunk.get(Position).y[i]) * dt;
        chunk.get(Position).x[i] = mix satisfies number;
      }
    }
  });
});
