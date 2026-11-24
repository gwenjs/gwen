import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

export const Move = defineSystem("Move", () => {
  onUpdate(() => {
    const movers = useQuery([Position]);
    return /*@map*/ mapMark ?? movers;
  });
});
