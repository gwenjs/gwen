import * as S from "@gwenjs/core/system";
import { Position } from "./components";

const api = {
  useQuery(items) {
    return items;
  },
};

export const Move = S.defineSystem("Move", () => {
  const movers = api.useQuery([Position]);
  return movers;
});

const _gwen_q0 = [Position];
export const Late = S.defineSystem("Late", () => {
  const found = S.useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? found;
});
