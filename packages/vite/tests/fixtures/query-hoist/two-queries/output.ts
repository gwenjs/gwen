import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position];
const _gwen_q1 = [Velocity];
export const Move = defineSystem("Move", () => {
  const first = useQuery(_gwen_q0);
  const second = useQuery(_gwen_q1);
  return /*@map*/ mapMark ?? first ?? second;
});
