import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const Tag = {},
  M = () => useQuery([Tag]);

const _gwen_q0 = [Position];
export const Late = defineSystem("Late", () => {
  const found = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? found ?? M() ?? Tag;
});
