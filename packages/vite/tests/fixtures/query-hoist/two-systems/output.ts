import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position];
export const Move = defineSystem("Move", () => {
  const movers = useQuery(_gwen_q0);
  return movers;
});

const _gwen_q1 = [Velocity];
export const Stay = defineSystem("Stay", () => {
  const rest = useQuery(_gwen_q1);
  return /*@map*/ mapMark ?? rest;
});
