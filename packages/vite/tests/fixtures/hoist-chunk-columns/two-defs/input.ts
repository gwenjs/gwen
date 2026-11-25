import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Angle } from "./components";

const Spin = defineComponent({ name: "Spin", schema: { turn: Types.f32 } });

export const Spinner = defineSystem("Spinner", () => {
  const q = useQuery([Angle, Spin]);
  onUpdate((dt) => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        chunk.get(Angle).rad[i] += chunk.get(Spin).turn[i] * dt;
      }
    }
  });
});
