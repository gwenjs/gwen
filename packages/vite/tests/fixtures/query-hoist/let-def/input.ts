import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

let Tag = { name: "Tag" };

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Tag]);
  return movers;
});
export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
Tag = { name: "Tag2" };
