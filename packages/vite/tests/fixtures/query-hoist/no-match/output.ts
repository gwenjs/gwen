import { useQuery } from "other-lib";
import { defineSystem, useQuery as realQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Position]);
  return movers;
});

const _gwen_q0 = [Position];
export const Late = defineSystem("Late", () => {
  const found = realQuery(_gwen_q0);
  return /*@map*/ mapMark ?? found;
});
