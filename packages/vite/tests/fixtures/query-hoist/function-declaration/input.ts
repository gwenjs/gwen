import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const started = setup();

function setup() {
  return useQuery([Position]);
}

export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found ?? started;
});
