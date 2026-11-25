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
      }
    }
  });
});

const _gwen_q1 = [Velocity, Position];
export const Braker = defineSystem("Braker", () => {
  const q = useQuery(_gwen_q1);
  onUpdate((dt) => {
    for (const chunk of q) {
      const _gwen_c2 = chunk.get(Velocity);
      const _gwen_c3 = chunk.get(Position);
      for (let i = 0; i < chunk.count; i++) {
        _gwen_c2.vx[i] -= _gwen_c3.x[i] * dt;
      }
    }
  });
});
