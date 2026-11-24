import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const _gwen_q0 = [Position];
export const Move = defineSystem("Move", () => {
  onUpdate(() => {
    const movers = useQuery(_gwen_q0);
    return /*@map*/ mapMark ?? movers;
  });
});
