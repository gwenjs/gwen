import { defineSystem, useQuery } from "@gwenjs/core/system";

export const Tag = { name: "Tag" };

export const Move = defineSystem("Move", () => {
  const movers = useQuery([Tag]);
  return /*@map*/ mapMark ?? movers;
});
