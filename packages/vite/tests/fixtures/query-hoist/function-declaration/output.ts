import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const started = setup();

function setup() {
  return useQuery([Position]);
}

const _gwen_q0 = [Position];
export const Late = defineSystem("Late", () => {
  const found = useQuery(_gwen_q0);
  return /*@map*/ mapMark ?? found ?? started;
});
