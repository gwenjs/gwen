import { useQuery } from "other-lib";
import { defineSystem, useQuery as realQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Position]);
  return movers;
});

export const Late = defineSystem("Late", () => {
  const found = realQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
