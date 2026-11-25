import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

// @gwen-no-optimize
export const A = defineSystem("A", () => {
  const movers = useQuery([Position]);
  return movers;
});

export const B = defineSystem("B", () => {
  const movers = useQuery([Velocity]);
  return movers;
});
