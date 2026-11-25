import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position, Velocity];
export const Mover = defineSystem("Mover", () => {
  const q = useQuery(_gwen_q0);
  onUpdate((dt) => {
    for (const chunk of q) {
      const _gwen_c0 = chunk.get(Velocity);
      const _gwen_c1 = chunk.get(Position);
      for (let i = 0; i < chunk.count; i++) {
        const vx = _gwen_c0.vx[i];
        const speed = Math.min(Math.sqrt(vx * vx), Math.PI);
        _gwen_c1.x[i] += speed * dt;
      }
    }
  });
});
