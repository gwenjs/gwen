import { defineActor } from "@gwenjs/core/actor";
import { useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const prefab = { name: "boss" };

const _gwen_q0 = [Position];
export const Boss = defineActor("Boss", prefab, () => {
  const movers = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? movers;
});
