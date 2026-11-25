import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export let Spin = Velocity;

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Spin]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Spin).vx[i] * dt;
      }
    }
  });
});

Spin = Velocity;
