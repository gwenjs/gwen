import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Tail]);
  return movers;
});

export const Tail = { name: "Tail" };
const _gwen_q0 = [Position];
export const Late = defineSystem("Late", () => {
  const found = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? found;
});
