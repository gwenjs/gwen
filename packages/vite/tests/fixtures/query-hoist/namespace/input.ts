import * as S from "@gwenjs/core/system";
import { Position, Velocity } from "./components";

export const Move = S.defineSystem("Move", () => {
  const movers = S.useQuery([Position, Velocity]);
  return /*@map*/ mapMark ?? movers;
});
