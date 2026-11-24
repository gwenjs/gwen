import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  const _gwen_q0 = 1;
  const movers = useQuery([Position]);
  return /*@map*/ mapMark ?? movers;
});
