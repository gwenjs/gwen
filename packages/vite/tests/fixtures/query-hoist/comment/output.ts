import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

// useQuery([Position])
export const Move = defineSystem("Move", () => {
  return 1;
});
const _gwen_q0 = [Position];
export const Late = defineSystem("Late", () => {
  const found = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? found;
});
