import { defineSystem, onUpdate } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const useQuery = (defs: object[]): object[] => defs;

export const Mover = defineSystem("Mover", () => {
  const q = useQuery([Position, Velocity]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Position).x[i] += chunk.get(Velocity).vx[i] * dt;
      }
    }
  });
});
