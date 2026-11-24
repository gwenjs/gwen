import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Position, Velocity]);
  return /*@map*/ mapMark ?? movers;
});
