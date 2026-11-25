import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

// @gwen-no-optimize
export const A = defineSystem("A", () => {
  const movers = useQuery([Position]);
  return movers;
});

const _gwen_q0 = [Velocity];
export const B = defineSystem("B", () => {
  const movers = useQuery(_gwen_q0);
  return movers;
});
