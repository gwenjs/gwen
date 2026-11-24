import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const _gwen_q0 = 1;

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Position]);
  return /*@map*/ mapMark ?? movers;
});
