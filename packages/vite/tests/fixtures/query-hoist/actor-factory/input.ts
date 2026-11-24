import { defineActor } from "@gwenjs/core/actor";
import { useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const prefab = { name: "boss" };

export const Boss = defineActor("Boss", prefab, () => {
  const movers = useQuery([Position]);
  return /*@map*/ mapMark ?? movers;
});
