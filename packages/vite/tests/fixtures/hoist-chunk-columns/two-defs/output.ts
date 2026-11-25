import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Angle } from "./components";

const Spin = defineComponent({ name: "Spin", schema: { turn: Types.f32 } });

const _gwen_q0 = [Angle, Spin];
export const Spinner = defineSystem("Spinner", () => {
  const q = useQuery(_gwen_q0);
  onUpdate((dt) => {
    for (const chunk of q) {
      const _gwen_c0 = chunk.get(Angle);
      const _gwen_c1 = chunk.get(Spin);
      for (let i = 0; i < chunk.count; i++) {
        _gwen_c0.rad[i] += _gwen_c1.turn[i] * dt;
      }
    }
  });
});
