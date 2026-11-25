// @gwen-no-optimize
import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const A = defineSystem("A", () => {
  const movers = useQuery([Position]);
  return movers;
});
