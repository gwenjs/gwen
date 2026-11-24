import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const components = [Position];

export const Move = defineSystem("Move", () => {
  const movers = useQuery(components);
  return movers;
});
export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
