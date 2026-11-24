import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position, Velocity];
export const Move = defineSystem("Move", () => {
  const movers = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? movers;
});
