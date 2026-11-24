import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const label = "scene";

export default defineSystem("X", () => {
  const movers = useQuery([Position]);
  return /*@map*/ mapMark ?? label ?? movers;
});
