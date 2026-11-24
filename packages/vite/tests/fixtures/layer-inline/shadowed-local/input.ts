import { defineLayers } from "@gwenjs/physics2d";
export const layers = defineLayers;
const L = defineLayers({ anchor: 1 });
export function inner(L: { k: number }) {
  const hidden = L.k;
  return hidden;
}
export function nested() {
  const L = { k: 2 };
  return L.k;
}
export const value = L.anchor + /*@map*/ kept;
