import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
function dec(value: unknown) {
  return value;
}
const L = defineLayers({ anchor: 1 });
@dec
export class Box {
  readonly layer = L.anchor + /*@map*/ kept;
}
