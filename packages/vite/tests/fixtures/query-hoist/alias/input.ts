import { defineSystem as ds, useQuery as uq } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Move = ds("Move", () => {
  const movers = uq([Position, Velocity]);
  return /*@map*/ mapMark ?? movers;
});
