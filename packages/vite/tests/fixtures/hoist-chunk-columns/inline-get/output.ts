import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position, Velocity];
export const Mover = defineSystem("Mover", () => {
  const q = useQuery(_gwen_q0);
  onUpdate((dt) => {
    for (const chunk of q) {
      const _gwen_c0 = chunk.get(Position);
      const _gwen_c1 = chunk.get(Velocity);
      for (let i = 0; i < chunk.count; i++) {
        _gwen_c0.x[i] += _gwen_c1.vx[i] * dt;
        _gwen_c0.y[i] += _gwen_c1.vy[i] * dt;
      }
    }
  });
});
