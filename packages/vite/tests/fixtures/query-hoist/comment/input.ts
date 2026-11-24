import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

// useQuery([Position])
export const Move = defineSystem("Move", () => {
  return 1;
});
export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
