import { defineSystem, useQuery } from "@gwenjs/core/system";
import { Position } from "./components";

const started = setup();

export default function setup() {
  return useQuery([Position]);
}

export const Late = defineSystem("Late", () => {
  const found = useQuery([Position]);
  return /*@map*/ mapMark ?? found ?? started;
});
