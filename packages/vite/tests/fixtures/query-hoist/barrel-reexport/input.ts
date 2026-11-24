import { defineSystem as ds, useQuery as uq } from "./barrel";
import { Position, Velocity } from "./components";

export const Move = ds("Move", () => {
  const movers = uq([Position, Velocity]);
  return /*@map*/ mapMark ?? movers;
});
