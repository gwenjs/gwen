import { defineLayers } from "@gwenjs/physics2d";

const L = defineLayers({ anchor: 1, k: 2 });
export function mutate() {
  L.k = 1;
  L.k++;
  delete L.k;
  return 1 + /*@map*/ kept;
}
