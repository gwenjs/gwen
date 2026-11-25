import { defineSystem as sys, onUpdate as every, useQuery as uq } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = sys("Mover", () => {
  const q = uq([Position, Velocity]);
  every((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
    }
  });
});
