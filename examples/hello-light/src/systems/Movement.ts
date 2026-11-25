import { Position } from "../components/Position";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + 0.5 * dt;
        pos.y[row] = (pos.y[row] ?? 0) + 0.1 * dt;
      }
    }
  });
});
