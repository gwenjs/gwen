import * as S from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

const _gwen_q0 = [Position, Velocity];
export const Move = S.defineSystem("Move", () => {
  const movers = S.useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? movers;
});
