import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Position]);
  return /*@map*/ mapMark ?? movers;
});

export const View = <span />;
