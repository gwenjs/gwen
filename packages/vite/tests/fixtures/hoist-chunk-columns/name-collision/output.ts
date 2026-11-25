import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const _gwen_c0 = 1;

const _gwen_q0 = [Position, Velocity];
export const Mover = defineSystem("Mover", () => {
  const q = useQuery(_gwen_q0);
  onUpdate((dt) => {
    for (const chunk of q) {
      const _gwen_c1 = chunk.get(Position);
      const _gwen_c2 = chunk.get(Velocity);
      for (let i = 0; i < chunk.count; i++) {
        _gwen_c1.x[i] += _gwen_c2.vx[i] * dt;
      }
    }
  });
});
