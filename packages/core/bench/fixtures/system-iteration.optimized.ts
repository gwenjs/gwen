import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./system-iteration.components";

const _gwen_q0 = [Position, Velocity];
export const Mover = defineSystem("bench-system-iteration", () => {
  const q = useQuery(_gwen_q0);
  onUpdate((dt) => {
    for (const chunk of q) {
      const _gwen_c0 = chunk.get(Position);
      const _gwen_c1 = chunk.get(Velocity);
      for (let i = 0; i < chunk.count; i++) {
        const x = _gwen_c0.x[i] ?? 0;
        const y = _gwen_c0.y[i] ?? 0;
        _gwen_c0.x[i] = x + (_gwen_c1.vx[i] ?? 0) * dt;
        _gwen_c0.y[i] = y + (_gwen_c1.vy[i] ?? 0) * dt;
      }
    }
  });
});
