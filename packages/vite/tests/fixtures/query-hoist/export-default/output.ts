import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const label = "scene";

const _gwen_q0 = [Position];
export default defineSystem("X", () => {
  const movers = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? label ?? movers;
});
