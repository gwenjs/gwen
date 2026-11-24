import { defineSystem, useQuery } from "@gwenjs/core/system";

export const Tag = { name: "Tag" };

const _gwen_q0 = [Tag];
export const Move = defineSystem("Move", () => {
  const movers = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? movers;
});
