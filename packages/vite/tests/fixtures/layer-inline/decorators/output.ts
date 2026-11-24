import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
function dec(value: unknown) {
  return value;
}

@dec
export class Box {
  readonly layer = 1 + /*@map*/ kept;
}
