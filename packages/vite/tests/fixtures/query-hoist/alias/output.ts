import { defineSystem as ds, useQuery as uq } from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position, Velocity];
export const Move = ds("Move", () => {
  const movers = uq(_gwen_q0);
  return /*@map*/ mapMark ?? movers;
});
