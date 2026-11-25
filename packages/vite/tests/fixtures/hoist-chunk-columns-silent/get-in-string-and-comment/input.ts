import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate(() => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        // chunk.get(Position).x[i] += 1;
        const text = "chunk.get(Velocity)";
        void text;
      }
    }
  });
});
