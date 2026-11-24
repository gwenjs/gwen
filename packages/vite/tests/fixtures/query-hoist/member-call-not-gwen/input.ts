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

export const Late = S.defineSystem("Late", () => {
  const found = S.useQuery([Position]);
  return /*@map*/ mapMark ?? found;
});
