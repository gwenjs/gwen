import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const Tag = {},
  M = () => useQuery([Tag]);

export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found ?? M() ?? Tag;
});
