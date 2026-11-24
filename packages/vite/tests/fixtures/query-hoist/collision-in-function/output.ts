import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const _gwen_q1 = [Position];
export const Move = defineSystem("Move", () => {
  const _gwen_q0 = 1;
  const movers = useQuery(_gwen_q1);
  return /*@map*/ mapMark ?? movers;
});
