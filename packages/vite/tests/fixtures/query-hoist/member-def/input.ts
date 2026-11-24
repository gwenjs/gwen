import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

import * as C from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([C.Position]);
  return movers;
});
export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
