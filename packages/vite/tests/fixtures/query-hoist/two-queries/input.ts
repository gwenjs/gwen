import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Move = defineSystem("Move", () => {
  const first = useQuery([Position]);
  const second = useQuery([Velocity]);
  return /*@map*/ mapMark ?? first ?? second;
});
