import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([]);
  return movers;
});
export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
