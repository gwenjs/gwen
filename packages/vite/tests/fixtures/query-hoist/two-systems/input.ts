import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Position]);
  return movers;
});

export const Stay = defineSystem("Stay", () => {
  const rest = useQuery([Velocity]);
  return /*@map*/ mapMark ?? rest;
});
