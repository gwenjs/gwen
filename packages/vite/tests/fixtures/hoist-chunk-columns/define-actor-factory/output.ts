import { defineActor } from "@gwenjs/core/actor";
import { onUpdate, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const prefab = { name: "mover" };

const _gwen_q0 = [Position, Velocity];
export const Mover = defineActor("Mover", prefab, () => {
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
